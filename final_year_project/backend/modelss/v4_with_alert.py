"""
Real-time Object Detection with Priority Safety Alerts
======================================================

This script uses a YOLOv8 model for real-time object detection and provides
advanced voice feedback. It includes a priority alert system that adds a "Warning!"
prefix for potentially dangerous objects (e.g., people, cars, bikes) to enhance
safety for visually impaired users.

Features:
- YOLOv8 real-time detection
- Directional awareness (left, right, center)
- Relative distance estimation (close, medium, far)
- Priority alerts for important objects
- Intelligent cooldown to prevent repetition

Requirements:
- ultralytics
- opencv-python
- pyttsx3
- torch

"""

import cv2
import time
import threading
from collections import defaultdict
import pyttsx3
from ultralytics import YOLO
import numpy as np


class YOLODetectionTTS:
    """
    A class for real-time object detection with priority safety alerts via TTS.
    """
    
    def __init__(self, model_path="yolov8n.pt", cooldown_time=3.0):
        self.model_path = model_path
        self.cooldown_time = cooldown_time
        self.last_spoken_time = defaultdict(float)
        
        # /// NEW: Define a set of priority objects for alerts ///
        # Using a set for fast 'in' checking, as you described.
        self.priority_objects = {
            'person', 'car', 'bicycle', 'motorcycle', 'bus', 'truck', 'dog'
        }
        
        self.tts_engine = pyttsx3.init()
        self.setup_tts()
        
        print("Loading YOLO model...")
        try:
            self.model = YOLO(model_path)
            print(f"✓ YOLO model loaded successfully from {model_path}")
        except Exception as e:
            print(f"✗ Error loading YOLO model: {e}")
            raise
        
        self.cap = None
        self.running = False
        self.tts_queue = []
        self.tts_thread = None
        self.tts_lock = threading.Lock()
    
    def setup_tts(self):
        try:
            self.tts_engine.setProperty('rate', 170) # Slightly faster for urgent warnings
            self.tts_engine.setProperty('volume', 1.0) # Max volume for safety
            voices = self.tts_engine.getProperty('voices')
            if voices:
                self.tts_engine.setProperty('voice', voices[0].id)
            print("✓ Text-to-speech engine initialized")
        except Exception as e:
            print(f"⚠ Warning: TTS setup issue: {e}")
    
    def initialize_webcam(self, camera_index=0):
        print("Initializing webcam...")
        self.cap = cv2.VideoCapture(camera_index)
        if not self.cap.isOpened():
            raise RuntimeError(f"✗ Cannot open camera with index {camera_index}")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        print("✓ Webcam initialized successfully")
    
    def speak_async(self, text):
        with self.tts_lock:
            self.tts_queue.append(text)
    
    def tts_worker(self):
        while self.running:
            text_to_speak = None
            with self.tts_lock:
                if self.tts_queue:
                    text_to_speak = self.tts_queue.pop(0)
            if text_to_speak:
                try:
                    self.tts_engine.say(text_to_speak)
                    self.tts_engine.runAndWait()
                except Exception as e:
                    print(f"⚠ TTS error: {e}")
            time.sleep(0.1)
    
    def should_announce(self, class_name):
        current_time = time.time()
        if current_time - self.last_spoken_time[class_name] >= self.cooldown_time:
            self.last_spoken_time[class_name] = current_time
            return True
        return False

    # ==================================================================
    # /// MODIFIED FUNCTION ///
    # Now includes logic for priority alerts.
    # ==================================================================
    def draw_detections(self, frame, results):
        if not results or len(results) == 0:
            return frame
        
        objects_for_tts = []
        
        frame_height, frame_width, _ = frame.shape
        frame_area = frame_width * frame_height
        frame_center_x = frame_width / 2
        center_threshold = frame_width * 0.2
        
        for result in results:
            if result.boxes is None: continue
            
            boxes = result.boxes.xyxy.cpu().numpy()
            confidences = result.boxes.conf.cpu().numpy()
            class_ids = result.boxes.cls.cpu().numpy()
            
            for box, conf, class_id in zip(boxes, confidences, class_ids):
                if conf < 0.5: continue
                
                x1, y1, x2, y2 = map(int, box)
                class_name = self.model.names[int(class_id)]
                
                # --- PRIORITY CHECK ---
                is_priority = class_name in self.priority_objects
                
                # --- POSITION & DISTANCE LOGIC (Unchanged) ---
                object_center_x = (x1 + x2) / 2
                position_str = "in front"
                if object_center_x < frame_center_x - center_threshold:
                    position_str = "to the left"
                elif object_center_x > frame_center_x + center_threshold:
                    position_str = "to the right"
                
                box_area = (x2 - x1) * (y2 - y1)
                area_ratio = box_area / frame_area
                distance_str = "far away"
                if area_ratio > 0.15: distance_str = "close"
                elif area_ratio > 0.05: distance_str = "at a medium distance"

                objects_for_tts.append((class_name, position_str, distance_str, is_priority))

                # --- DRAWING ON FRAME ---
                # /// MODIFIED: Change box color based on priority ///
                box_color = (0, 0, 255) if is_priority else (0, 255, 0) # Red for priority, Green for normal
                
                cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
                label = f"{class_name}: {conf:.2f} ({distance_str.split(' ')[0]})"
                label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
                cv2.rectangle(frame, (x1, y1 - label_size[1] - 10), 
                              (x1 + label_size[0], y1), box_color, -1)
                cv2.putText(frame, label, (x1, y1 - 5), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
        
        # --- HANDLE TTS ANNOUNCEMENTS ---
        for obj_name, position, distance, is_priority in objects_for_tts:
            if self.should_announce(obj_name):
                # /// MODIFIED: Add "Warning!" prefix for priority objects ///
                if is_priority:
                    announcement = f"Warning! {obj_name} {distance} {position}"
                else:
                    announcement = f"{obj_name} {distance} {position}"
                
                print(f"🔊 Speaking: {announcement}")
                self.speak_async(announcement)
        
        return frame
    
    def add_info_overlay(self, frame):
        # This function is unchanged
        height, _ = frame.shape[:2]
        instructions = ["Press 'q' to quit", "Press 'r' to reset TTS cooldowns"]
        for i, instruction in enumerate(instructions):
            y_pos = height - 40 + (i * 20)
            cv2.putText(frame, instruction, (10, y_pos), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        return frame
    
    def run_detection(self):
        # This function is unchanged
        try:
            self.initialize_webcam()
            self.running = True
            self.tts_thread = threading.Thread(target=self.tts_worker, daemon=True)
            self.tts_thread.start()
            
            print("\n" + "="*50)
            print("🎥 Real-time YOLO Detection with Priority Alerts")
            print("="*50 + "\n")
            
            while self.running:
                ret, frame = self.cap.read()
                if not ret or frame is None: continue
                try:
                    results = self.model(frame, verbose=False)
                    frame = self.draw_detections(frame, results)
                    frame = self.add_info_overlay(frame)
                    cv2.imshow('YOLO Detection with Priority Alerts', frame)
                except Exception as e:
                    print(f"⚠ Warning: Detection error: {e}")
                
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'): break
                elif key == ord('r'): self.last_spoken_time.clear()
        
        except Exception as e:
            print(f"✗ Error in detection loop: {e}")
        finally:
            self.cleanup()
    
    def cleanup(self):
        # This function is unchanged
        print("\n🧹 Cleaning up resources...")
        self.running = False
        if self.cap is not None: self.cap.release()
        cv2.destroyAllWindows()
        if self.tts_thread and self.tts_thread.is_alive(): self.tts_thread.join(timeout=2)
        print("✓ Cleanup completed")

def main():
    try:
        detector = YOLODetectionTTS(model_path="yolov8n.pt", cooldown_time=3.0)
        detector.run_detection()
    except Exception as e:
        print(f"\n✗ Error: {e}")
    finally:
        print("👋 Goodbye!")

if __name__ == "__main__":
    main()