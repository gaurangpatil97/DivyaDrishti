import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';

// ⚠️ Replace with your IPv4 (from ipconfig)
const SERVER_URL = 'http://192.168.31.185:5000/detect';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [serverMessage, setServerMessage] = useState("Connecting...");
  const [isLooping, setIsLooping] = useState(false);

  // IMPORTANT FIX — Camera ref must be "any"
  const cameraRef = useRef<any>(null);

  // 1. Handle Permissions
  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>We need camera access to see obstacles.</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 2. Frame capture loop
  const processFrame = async () => {
    if (!isLooping || !cameraRef.current) return;

    try {
      // A. Capture low-quality image for speed
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3,
        base64: false,
        skipProcessing: true,
      });

      if (!photo) return;

      // B. FormData FIXED
      const formData = new FormData();
      formData.append("image", {
        uri: photo.uri,
        type: "image/jpeg",
        name: "frame.jpg",
      } as any);

      // C. Send to Python Server
      const response = await fetch(SERVER_URL, {
        method: "POST",
        body: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      const data = await response.json();

      // D. Handle result
      if (data.alert) {
        setServerMessage(data.alert);
        if (data.alert.includes("Stop") || data.alert.includes("Warning")) {
          Speech.stop();
          Speech.speak(data.alert);
        }
      }
    } catch (error) {
      console.log("Connection Error:", error);
      setServerMessage("Searching for PC...");
    }

    // E. Continue loop
    setTimeout(() => {
      if (isLooping) processFrame();
    }, 500);
  };

  // Start/stop button
  const toggleDetection = () => {
    if (isLooping) {
      setIsLooping(false);
      setServerMessage("Paused");
    } else {
      setIsLooping(true);
      setServerMessage("Starting...");
      setTimeout(processFrame, 100);
    }
  };

  // Auto start on mount
  useEffect(() => {
    setIsLooping(true);
    setTimeout(processFrame, 1000);
    return () => setIsLooping(false);
  }, []);

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} ref={cameraRef} facing="back">
        <View style={styles.overlay}>
          <View style={styles.banner}>
            <Text style={styles.alertText}>{serverMessage}</Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, isLooping ? styles.btnStop : styles.btnStart]}
            onPress={toggleDetection}
          >
            <Text style={styles.btnText}>
              {isLooping ? "STOP DETECTION" : "START DETECTION"}
            </Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  text: {
    color: "#fff",
    fontSize: 18,
    textAlign: "center",
    marginBottom: 20,
    marginTop: 50,
  },
  camera: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "space-between",
    padding: 30,
  },
  banner: {
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 20,
    borderRadius: 15,
    marginTop: 40,
  },
  alertText: {
    color: "#32D74B",
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
  },
  btn: {
    padding: 20,
    borderRadius: 15,
    alignItems: "center",
    marginBottom: 20,
  },
  btnStart: { backgroundColor: "#2196F3" },
  btnStop: { backgroundColor: "#FF3B30" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});
