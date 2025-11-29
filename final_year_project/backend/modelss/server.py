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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== CONFIGURATION ====================
class Config:
    MODEL_FILE = 'yolo11n.pt'  # YOLOv11 Nano model
    COOLDOWN_TIME = 3.0  # Seconds between same alerts
    CONFIDENCE_THRESHOLD = 0.5
    
    # Priority objects for safety alerts
    PRIORITY_OBJECTS = {
        'person', 'car', 'bicycle', 'motorcycle', 'bus', 'truck', 
        'dog', 'cat', 'traffic light', 'stop sign', 'fire hydrant',
        'parking meter', 'bench', 'bird', 'horse', 'sheep', 'cow',
        'elephant', 'bear', 'zebra', 'giraffe'
    }
    
    # Distance thresholds (by area ratio)
    DISTANCE_CLOSE = 0.15
    DISTANCE_MEDIUM = 0.05
    
    # Position threshold (percentage of frame width)
    CENTER_THRESHOLD = 0.2

config = Config()

# ==================== GLOBAL STATE ====================
last_announcement_time = defaultdict(float)
frame_count = 0
model = None

# ==================== MODEL INITIALIZATION ====================
def initialize_model():
    """Initialize YOLO model with GPU support if available."""
    global model
    
    logger.info(f"🔄 Loading YOLO model: {config.MODEL_FILE}...")
    
    try:
        # Initialize YOLOv11 model (will auto-download on first run)
        model = YOLO(config.MODEL_FILE)
        
        # Check if GPU is available
        if torch.cuda.is_available():
            device = 'cuda'
            gpu_name = torch.cuda.get_device_name(0)
            gpu_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
            logger.info(f"✅ GPU detected: {gpu_name}")
            logger.info(f"💾 GPU Memory: {gpu_memory:.2f} GB")
        else:
            device = 'cpu'
            logger.info("ℹ️  Running on CPU (GPU not available)")
        
        # Move model to device
        model.to(device)
        
        # Verify model is loaded
        if hasattr(model, 'names'):
            num_classes = len(model.names)
            logger.info(f"📦 Model classes: {num_classes}")
        
        logger.info(f"✅ YOLOv11 model loaded successfully on {device.upper()}!")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Error loading model: {e}")
        logger.error("💡 Tip: Run 'pip install --upgrade ultralytics' to ensure YOLOv11 support")
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
    """Process uploaded image with rotation."""
    try:
        # Load image
        img = Image.open(io.BytesIO(image_file.read())).convert('RGB')
        
        # Rotate 90 degrees clockwise for portrait mode
        # (Keep this if your mobile app sends images in landscape)
        img = img.rotate(-90, expand=True)
        
        logger.info(f"📐 Image processed: {img.size[0]}x{img.size[1]}")
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
    
    # Run YOLOv11 inference
    start_time = time.time()
    results = model.predict(
        source=img, 
        save=False, 
        verbose=False, 
        conf=config.CONFIDENCE_THRESHOLD,
        device='cuda' if torch.cuda.is_available() else 'cpu'
    )
    inference_time = (time.time() - start_time) * 1000  # Convert to ms
    
    result = results[0]
    
    detections = []
    alerts = []
    detected_items = []
    
    # Process detections
    if result.boxes is not None and len(result.boxes) > 0:
        boxes = result.boxes.xyxy.cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()
        class_ids = result.boxes.cls.cpu().numpy()
        
        for box, conf, class_id in zip(boxes, confidences, class_ids):
            if float(conf) < config.CONFIDENCE_THRESHOLD:
                continue
            
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
                logger.info(f"🚨 {alert_msg}")
            
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
    
    logger.info(
        f"✅ Frame {frame_count}: {len(detections)} objects detected "
        f"({inference_time:.1f}ms)"
    )
    
    return {
        "alert": alert_message,
        "alerts": alerts,
        "objects": detected_items,
        "detections": detections,
        "frameWidth": img_width,
        "frameHeight": img_height,
        "frameCount": frame_count,
        "inferenceTime": round(inference_time, 2),
        "timestamp": datetime.now().isoformat()
    }

# ==================== API ENDPOINTS ====================
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
        "model_version": config.MODEL_FILE,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "frames_processed": frame_count,
        "confidence_threshold": config.CONFIDENCE_THRESHOLD,
        "server_time": datetime.now().isoformat()
    })

@app.route('/detect', methods=['POST'])
def detect_object():
    """Main detection endpoint."""
    if not model:
        logger.error("Model not loaded")
        return jsonify({"error": "Model not loaded"}), 500
    
    if 'image' not in request.files:
        logger.warning("No image in request")
        return jsonify({"error": "No image sent"}), 400
    
    try:
        file = request.files['image']
        
        # Validate file
        if file.filename == '':
            return jsonify({"error": "Empty filename"}), 400
        
        # Process image
        img = process_image(file)
        
        # Run detection
        result = run_detection(img)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"❌ Detection error: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/reset', methods=['POST'])
def reset_cooldowns():
    """Reset announcement cooldowns."""
    global last_announcement_time
    last_announcement_time.clear()
    logger.info("🔄 Cooldowns reset")
    return jsonify({
        "message": "Cooldowns reset successfully",
        "timestamp": datetime.now().isoformat()
    })

@app.route('/stats', methods=['GET'])
def get_stats():
    """Get server statistics."""
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "gpu_name": torch.cuda.get_device_name(0),
            "gpu_memory_allocated": f"{torch.cuda.memory_allocated(0) / 1024**2:.2f} MB",
            "gpu_memory_total": f"{torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB"
        }
    
    return jsonify({
        "frames_processed": frame_count,
        "model": config.MODEL_FILE,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "confidence_threshold": config.CONFIDENCE_THRESHOLD,
        "priority_objects": sorted(list(config.PRIORITY_OBJECTS)),
        "cooldown_time": config.COOLDOWN_TIME,
        "gpu_info": gpu_info,
        "server_uptime": datetime.now().isoformat()
    })

@app.route('/config', methods=['GET'])
def get_config():
    """Get current configuration."""
    return jsonify({
        "model_file": config.MODEL_FILE,
        "confidence_threshold": config.CONFIDENCE_THRESHOLD,
        "cooldown_time": config.COOLDOWN_TIME,
        "distance_close": config.DISTANCE_CLOSE,
        "distance_medium": config.DISTANCE_MEDIUM,
        "center_threshold": config.CENTER_THRESHOLD,
        "priority_objects_count": len(config.PRIORITY_OBJECTS)
    })

@app.route('/classes', methods=['GET'])
def get_classes():
    """Get all detectable classes."""
    if not model:
        return jsonify({"error": "Model not loaded"}), 500
    
    return jsonify({
        "classes": model.names,
        "total_classes": len(model.names),
        "priority_classes": sorted(list(config.PRIORITY_OBJECTS))
    })

# ==================== ERROR HANDLERS ====================
@app.errorhandler(404)
def not_found(error):
    return jsonify({
        "error": "Endpoint not found",
        "available_endpoints": [
            "POST /detect",
            "GET /health",
            "GET /stats",
            "GET /config",
            "GET /classes",
            "POST /reset"
        ]
    }), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {error}")
    return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "File too large"}), 413

# ==================== STARTUP ====================
if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 VISUAL ASSISTANCE DETECTION SERVER")
    print("🤖 Powered by YOLOv11 Nano")
    print("="*60 + "\n")
    
    # Initialize model
    if not initialize_model():
        print("\n❌ Failed to initialize model. Exiting.")
        print("💡 Troubleshooting:")
        print("   1. Ensure 'ultralytics' is installed: pip install ultralytics")
        print("   2. Update to latest version: pip install --upgrade ultralytics")
        print("   3. Check internet connection (model will download on first run)")
        print("   4. Check PyTorch installation: pip install torch torchvision")
        exit(1)
    
    print("\n" + "="*60)
    print("📡 Server Configuration:")
    print(f"   • Host: 0.0.0.0")
    print(f"   • Port: 5000")
    print(f"   • Model: {config.MODEL_FILE}")
    print(f"   • Device: {'GPU (CUDA)' if torch.cuda.is_available() else 'CPU'}")
    print(f"   • Confidence Threshold: {config.CONFIDENCE_THRESHOLD}")
    print(f"   • Priority Objects: {len(config.PRIORITY_OBJECTS)}")
    print(f"   • Alert Cooldown: {config.COOLDOWN_TIME}s")
    print("="*60 + "\n")
    
    print("🎯 Available Endpoints:")
    print("   • POST /detect     - Object detection (main endpoint)")
    print("   • GET  /health     - Health check")
    print("   • GET  /stats      - Server statistics")
    print("   • GET  /config     - Current configuration")
    print("   • GET  /classes    - All detectable classes")
    print("   • POST /reset      - Reset alert cooldowns")
    print("\n" + "="*60 + "\n")
    
    print("✨ Ready to process frames!")
    print("🔗 Test with: curl http://localhost:5000/health\n")
    
    # Run server
    try:
        app.run(
            host='0.0.0.0', 
            port=5000, 
            debug=False,
            threaded=True
        )
    except KeyboardInterrupt:
        print("\n\n👋 Server stopped gracefully")
    except Exception as e:
        logger.error(f"❌ Server error: {e}")
        print(f"\n❌ Server failed to start: {e}")