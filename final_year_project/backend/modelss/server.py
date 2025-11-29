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

# Global dictionary for cooldown
last_announcement_time = defaultdict(float)

print(f"🔄 Loading YOLO model: {MODEL_FILE}...")
try:
    model = YOLO(MODEL_FILE)
    print("✅ Model loaded successfully!")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    model = None


def should_announce(class_name):
    current_time = time.time()
    if current_time - last_announcement_time[class_name] >= COOLDOWN_TIME:
        last_announcement_time[class_name] = current_time
        return True
    return False


@app.route('/detect', methods=['POST'])
def detect_object():
    if not model:
        return jsonify({"error": "Model not loaded"}), 500

    if 'image' not in request.files:
        return jsonify({"error": "No image sent"}), 400

    try:
        file = request.files['image']

        # 1. Load image
        img = Image.open(io.BytesIO(file.read())).convert('RGB')

        # 🔥 🔥 🔥 ROTATE TO PORTRAIT MODE 🔥 🔥 🔥
        # Rotate 90 degrees clockwise
        img = img.rotate(-90, expand=True)
        img_width, img_height = img.size

        print("SERVER FRAME SIZE (rotated):", img.size)

        # 2. YOLO Detection
        results = model.predict(source=img, save=False, verbose=False, conf=0.5)
        result = results[0]

        frame_area = img_width * img_height
        frame_center_x = img_width / 2
        center_threshold = img_width * 0.2

        detections = []
        alerts = []
        detected_items = []

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

                is_priority = class_name in PRIORITY_OBJECTS

                object_center_x = (x1 + x2) / 2
                position_str = "in front"
                if object_center_x < frame_center_x - center_threshold:
                    position_str = "to the left"
                elif object_center_x > frame_center_x + center_threshold:
                    position_str = "to the right"

                box_area = (x2 - x1) * (y2 - y1)
                area_ratio = box_area / frame_area
                distance_str = "far away"
                if area_ratio > 0.15:
                    distance_str = "close"
                elif area_ratio > 0.05:
                    distance_str = "at a medium distance"

                if is_priority and should_announce(class_name):
                    alerts.append(f"Warning! {class_name} {distance_str} {position_str}")

                detections.append({
                    "class": class_name,
                    "confidence": float(conf),
                    "position": position_str,
                    "distance": distance_str,
                    "isPriority": is_priority,
                    "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
                })

        if alerts:
            alert_message = alerts[0]
        elif not detected_items:
            alert_message = ""
        else:
            alert_message = ""

        return jsonify({
            "alert": alert_message,
            "alerts": alerts,
            "objects": detected_items,
            "detections": detections,
            "frameWidth": img_width,
            "frameHeight": img_height
        })

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    print("🚀 Server running on port 5000...")
    app.run(host='0.0.0.0', port=5000)
