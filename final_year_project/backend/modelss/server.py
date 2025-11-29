import io
import time
from collections import defaultdict
from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLO
from PIL import Image

app = Flask(__name__)
CORS(app)

# --- CONFIGURATION ---
MODEL_FILE = 'yolov8n.pt'
COOLDOWN_TIME = 3.0  # Seconds to wait before repeating the same alert

# Priority objects for safety alerts
PRIORITY_OBJECTS = {
    'person', 'car', 'bicycle', 'motorcycle', 'bus', 'truck', 'dog'
}

# Global dictionary to track when an object was last "announced"
# key: class_name, value: timestamp
last_announcement_time = defaultdict(float)

print(f"🔄 Loading YOLO model: {MODEL_FILE}...")
try:
    model = YOLO(MODEL_FILE)
    print("✅ Model loaded successfully!")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    model = None

def should_announce(class_name):
    """
    Checks if enough time has passed since the last alert for this object.
    """
    current_time = time.time()
    if current_time - last_announcement_time[class_name] >= COOLDOWN_TIME:
        last_announcement_time[class_name] = current_time
        return True
    return False

@app.route('/detect', methods=['POST'])
def detect_object():
    """
    Detect objects and return results. 
    INCLUDES: Logic to prevent repetitive alerts (Cooldowns).
    """
    if not model:
        return jsonify({"error": "Model not loaded"}), 500

    if 'image' not in request.files:
        return jsonify({"error": "No image sent"}), 400

    try:
        # 1. Read Image
        file = request.files['image']
        img = Image.open(io.BytesIO(file.read())).convert('RGB')

        # 2. Run Inference
        results = model.predict(source=img, save=False, verbose=False, conf=0.5)
        result = results[0]

        img_width, img_height = img.size
        frame_area = img_width * img_height
        frame_center_x = img_width / 2
        center_threshold = img_width * 0.2

        detections = []
        alerts = []          # High priority alerts (with cooldown applied)
        detected_items = []  # Raw list of everything seen

        # 3. Parse detections
        if result.boxes is not None and len(result.boxes) > 0:
            boxes = result.boxes.xyxy.cpu().numpy()
            confidences = result.boxes.conf.cpu().numpy()
            class_ids = result.boxes.cls.cpu().numpy()

            for box, conf, class_id in zip(boxes, confidences, class_ids):
                if float(conf) < 0.5:
                    continue

                x1, y1, x2, y2 = map(int, box)
                class_name = model.names[int(class_id)]
                detected_items.append(class_name)

                # --- Priority Check ---
                is_priority = class_name in PRIORITY_OBJECTS

                # --- Position Logic ---
                object_center_x = (x1 + x2) / 2
                position_str = "in front"
                if object_center_x < frame_center_x - center_threshold:
                    position_str = "to the left"
                elif object_center_x > frame_center_x + center_threshold:
                    position_str = "to the right"

                # --- Distance Logic ---
                box_area = (x2 - x1) * (y2 - y1)
                area_ratio = box_area / frame_area
                distance_str = "far away"
                if area_ratio > 0.15:
                    distance_str = "close"
                elif area_ratio > 0.05:
                    distance_str = "at a medium distance"

                # --- Cooldown & Alert Generation ---
                # We only generate an alert text if:
                # 1. It is a priority object
                # 2. The cooldown timer has expired for this object type
                if is_priority:
                    if should_announce(class_name):
                        alerts.append(f"Warning! {class_name} {distance_str} {position_str}")
                
                # Add to structured list (for drawing boxes on the phone)
                detections.append({
                    "class": class_name,
                    "confidence": float(conf),
                    "position": position_str,
                    "distance": distance_str,
                    "isPriority": is_priority,
                    "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
                })

        # 4. Compose Primary Response
        # The 'alert' field is what the phone uses to Speak. 
        # If 'alerts' is empty (due to cooldown), the phone stays silent.
        if alerts:
            alert_message = alerts[0] # Take the first high-priority alert
        elif not detected_items:
            alert_message = "" # Silence if nothing is there
        else:
            # Optional: If you want it to speak non-priority items occasionally, add logic here.
            # For now, we leave it blank to reduce noise, or set generic status.
            alert_message = "" 

        return jsonify({
            "alert": alert_message,   # TTS text (Empty if cooldown is active)
            "alerts": alerts,         # List of urgent alerts
            "objects": detected_items,# List of all objects found
            "detections": detections  # Full data for UI drawing
        })

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("🚀 Server running on port 5000...")
    app.run(host='0.0.0.0', port=5000)