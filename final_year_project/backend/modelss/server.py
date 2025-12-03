import io
import time
import logging
from collections import defaultdict
from datetime import datetime

from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLO
from PIL import Image
import torch
import numpy as np

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Configure logging (reduced for performance)
logging.basicConfig(
    level=logging.WARNING,  # Only warnings and errors
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== CONFIGURATION ====================
class Config:
    MODEL_FILE = 'yolov8n.pt'
    COOLDOWN_TIME = 3.0  # Seconds between same alerts
    CONFIDENCE_THRESHOLD = 0.5

    # Priority objects for safety alerts
    PRIORITY_OBJECTS = {
        'person', 'car', 'bicycle', 'motorcycle', 'bus', 'truck',
        'dog', 'cat', 'traffic light', 'stop sign'
    }

    # Distance thresholds (by area ratio)
    DISTANCE_CLOSE = 0.15
    DISTANCE_MEDIUM = 0.05

    # Position threshold (percentage of frame width)
    CENTER_THRESHOLD = 0.2

    # NEW: performance tuning
    IMAGE_SIZE = 320          # YOLO input size (reduced for speed)
    MAX_IMAGE_EDGE = 480      # downscale very large images (reduced)
    USE_HALF = True           # fp16 on GPU for speed
    MAX_DETECTIONS = 8        # limit detections returned
    SKIP_RESIZE = False       # Skip expensive resize operations


config = Config()

# ==================== GLOBAL STATE ====================
last_announcement_time = defaultdict(float)
frame_count = 0
model = None
device = 'cuda' if torch.cuda.is_available() else 'cpu'

# ==================== MODEL INITIALIZATION ====================
def initialize_model():
  """Initialize YOLO model with GPU support if available."""
  global model

  logger.info(f"🔄 Loading YOLO model: {config.MODEL_FILE}...")

  try:
      model = YOLO(config.MODEL_FILE)

      model.to(device)

      # fuse conv+bn
      try:
          model.fuse()
      except Exception:
          logger.warning("Could not fuse model layers; continuing without fuse.")

      # half precision on GPU
      if device == 'cuda' and config.USE_HALF:
          try:
              model.model.half()
              logger.info("✅ Using FP16 on GPU")
          except Exception as e:
              logger.warning(f"Could not switch model to half precision: {e}")

      # eval / cudnn tuning
      try:
          model.model.eval()
      except Exception:
          pass

      if device == 'cuda':
          torch.backends.cudnn.benchmark = True
          logger.info(f"✅ GPU detected: {torch.cuda.get_device_name(0)}")
      else:
          logger.info("ℹ️ Running on CPU")

      logger.info(f"✅ Model loaded successfully on {device}!")
      return True

  except Exception as e:
      logger.error(f"❌ Error loading model: {e}")
      return False

# ==================== HELPER FUNCTIONS ====================
def should_announce(class_name: str) -> bool:
    """Check if enough time has passed to announce this object again."""
    current_time = time.time()
    if current_time - last_announcement_time[class_name] >= config.COOLDOWN_TIME:
        last_announcement_time[class_name] = current_time
        return True
    return False

def calculate_position(x1: float, x2: float, frame_width: int) -> str:
    """Determine object position relative to frame center."""
    object_center_x = (x1 + x2) / 2
    frame_center_x = frame_width / 2
    center_threshold = frame_width * config.CENTER_THRESHOLD

    if object_center_x < frame_center_x - center_threshold:
        return "to the left"
    elif object_center_x > frame_center_x + center_threshold:
        return "to the right"
    else:
        return "in front"

def calculate_distance(box_area: float, frame_area: float) -> str:
    """Estimate distance based on object size in frame."""
    area_ratio = box_area / frame_area

    if area_ratio > config.DISTANCE_CLOSE:
        return "close"
    elif area_ratio > config.DISTANCE_MEDIUM:
        return "at medium distance"
    else:
        return "far away"

def process_image(image_file) -> Image.Image:
    """Process uploaded image with rotation and downscaling."""
    try:
        img = Image.open(io.BytesIO(image_file.read())).convert('RGB')

        # Rotate 90 degrees clockwise for portrait mode
        img = img.rotate(-90, expand=True)

        # Aggressive downscaling for speed
        max_edge = config.MAX_IMAGE_EDGE
        w, h = img.size
        max_current_edge = max(w, h)
        if max_current_edge > max_edge:
            scale = max_edge / max_current_edge
            new_size = (int(w * scale), int(h * scale))
            # Use NEAREST for fastest resize (acceptable quality loss for speed)
            img = img.resize(new_size, Image.NEAREST)

        return img

    except Exception as e:
        logger.error(f"Error processing image: {e}")
        raise

def run_detection(img: Image.Image) -> dict:
    """Run YOLO detection on image and return structured results."""
    global frame_count
    frame_count += 1

    img_width, img_height = img.size
    frame_area = img_width * img_height

    # Run YOLO inference with aggressive optimizations
    with torch.inference_mode():
        results = model.predict(
            source=img,
            save=False,
            verbose=False,
            conf=config.CONFIDENCE_THRESHOLD,
            imgsz=config.IMAGE_SIZE,
            device=device,
            half=config.USE_HALF and device == 'cuda',
            augment=False,  # Disable augmentation for speed
            agnostic_nms=True,  # Faster NMS
            max_det=config.MAX_DETECTIONS,  # Limit detections at inference
        )

    result = results[0]

    detections = []
    alerts = []
    detected_items = []

    # Process detections
    if result.boxes is not None and len(result.boxes) > 0:
        boxes = result.boxes.xyxy.cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()
        class_ids = result.boxes.cls.cpu().numpy()

        # Filter by confidence once
        keep = confidences >= config.CONFIDENCE_THRESHOLD
        boxes = boxes[keep]
        confidences = confidences[keep]
        class_ids = class_ids[keep]

        # Limit to top detections by confidence
        if len(boxes) > config.MAX_DETECTIONS:
            top_indices = np.argsort(confidences)[-config.MAX_DETECTIONS:]
            boxes = boxes[top_indices]
            confidences = confidences[top_indices]
            class_ids = class_ids[top_indices]
        
        for box, conf, class_id in zip(boxes, confidences, class_ids):
            x1, y1, x2, y2 = map(int, box)
            class_name = model.names[int(class_id)]
            detected_items.append(class_name)

            is_priority = class_name in config.PRIORITY_OBJECTS

            # Calculate position
            position_str = calculate_position(x1, x2, img_width)

            # Calculate distance
            box_area = (x2 - x1) * (y2 - y1)
            distance_str = calculate_distance(box_area, frame_area)

            # Generate alert for priority objects
            if is_priority and should_announce(class_name):
                alert_msg = f"Warning! {class_name} {distance_str} {position_str}"
                alerts.append(alert_msg)

            # Add to detections
            detections.append({
                "class": class_name,
                "confidence": float(conf),
                "position": position_str,
                "distance": distance_str,
                "isPriority": is_priority,
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
            })

    # Prepare response
    alert_message = alerts[0] if alerts else ""

    return {
        "alert": alert_message,
        "alerts": alerts,
        "objects": detected_items,
        "detections": detections,
        "frameWidth": img_width,
        "frameHeight": img_height,
        "frameCount": frame_count,
        "timestamp": datetime.now().isoformat()
    }

# ==================== API ENDPOINTS ====================
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
        "device": device,
        "frames_processed": frame_count
    })

@app.route('/detect', methods=['POST'])
def detect_object():
    """Main detection endpoint."""
    start_time = time.time()
    
    if not model:
        logger.error("Model not loaded")
        return jsonify({"error": "Model not loaded"}), 500

    if 'image' not in request.files:
        logger.warning("No image in request")
        return jsonify({"error": "No image sent"}), 400

    try:
        file = request.files['image']

        # Process image
        img = process_image(file)

        # Run detection
        result = run_detection(img)
        
        # Add processing time
        result['processingTime'] = round((time.time() - start_time) * 1000, 2)  # ms
        
        # Create response with keepalive headers
        response = jsonify(result)
        response.headers['Connection'] = 'keep-alive'
        response.headers['Keep-Alive'] = 'timeout=30, max=1000'
        
        return response

    except Exception as e:
        logger.error(f"❌ Detection error: {e}", exc_info=True)
        # Return empty result instead of error to keep connection alive
        return jsonify({
            "alert": "",
            "alerts": [],
            "objects": [],
            "detections": [],
            "frameWidth": 640,
            "frameHeight": 480,
            "frameCount": frame_count,
            "timestamp": datetime.now().isoformat(),
            "error": str(e)
        }), 200  # Return 200 to avoid triggering retry logic

@app.route('/reset', methods=['POST'])
def reset_cooldowns():
    """Reset announcement cooldowns."""
    global last_announcement_time
    last_announcement_time.clear()
    logger.info("🔄 Cooldowns reset")
    return jsonify({"message": "Cooldowns reset"})

@app.route('/stats', methods=['GET'])
def get_stats():
    """Get server statistics."""
    return jsonify({
        "frames_processed": frame_count,
        "model": config.MODEL_FILE,
        "device": device,
        "confidence_threshold": config.CONFIDENCE_THRESHOLD,
        "priority_objects": list(config.PRIORITY_OBJECTS)
    })

# ==================== ERROR HANDLERS ====================
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {error}")
    return jsonify({"error": "Internal server error"}), 500

# ==================== STARTUP ====================
if __name__ == '__main__':
    print("\n" + "="*50)
    print("🚀 VISUAL ASSISTANCE DETECTION SERVER")
    print("="*50 + "\n")

    # Initialize model
    if not initialize_model():
        print("❌ Failed to initialize model. Exiting.")
        exit(1)

    print("\n" + "="*50)
    print("📡 Server Configuration:")
    print(f"   • Host: 0.0.0.0")
    print(f"   • Port: 5000")
    print(f"   • Model: {config.MODEL_FILE}")
    print(f"   • Device: {'GPU' if device == 'cuda' else 'CPU'}")
    print(f"   • Confidence: {config.CONFIDENCE_THRESHOLD}")
    print("="*50 + "\n")

    print("🎯 Available endpoints:")
    print("   • POST /detect     - Object detection")
    print("   • GET  /health     - Health check")
    print("   • GET  /stats      - Statistics")
    print("   • POST /reset      - Reset cooldowns")
    print("\n" + "="*50 + "\n")

    # Run server with optimized settings
    from werkzeug.serving import WSGIRequestHandler
    WSGIRequestHandler.protocol_version = "HTTP/1.1"
    
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=False,
        threaded=True,
        use_reloader=False,
        processes=1
    )
