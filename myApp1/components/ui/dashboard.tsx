import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Dimensions,
  Platform,
  TouchableOpacity,
} from 'react-native';

import { CameraView, useCameraPermissions } from 'expo-camera';

interface BoundingBoxCoords {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Detection {
  class: string;
  confidence: number;
  position: string;
  distance: string;
  isPriority: boolean;
  bbox: BoundingBoxCoords;
}

interface ServerResponse {
  alert: string;
  alerts: string[];
  objects: string[];
  detections: Detection[];
  frameWidth: number;
  frameHeight: number;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function Dashboard() {
  const serverUrl = 'http://192.168.31.185:5000/detect';

  const [permission, requestPermission] = useCameraPermissions();

  const [detections, setDetections] = useState<Detection[]>([]);
  const [alertText, setAlertText] = useState('Initializing...');
  const [isCameraReady, setIsCameraReady] = useState(false);

  const [serverW, setServerW] = useState(1);
  const [serverH, setServerH] = useState(1);

  const cameraRef = useRef<CameraView>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (isCameraReady && !runningRef.current) {
      runningRef.current = true;
      startRealtimeLoop();
    }
  }, [isCameraReady]);

  const startRealtimeLoop = async () => {
    while (runningRef.current) {
      await captureAndSendFrame();
    }
  };

  const stopRealtime = () => {
    runningRef.current = false;
  };

  const captureAndSendFrame = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.4,
        skipProcessing: true,
        base64: false,
      });

      const formData = new FormData();
      formData.append('image', {
        uri: Platform.OS === 'ios' ? photo.uri.replace('file://', '') : photo.uri,
        type: 'image/jpeg',
        name: 'frame.jpg',
      } as any);

      const response = await fetch(serverUrl, {
        method: 'POST',
        body: formData
      });

      const data: ServerResponse = await response.json();

      setDetections(data.detections || []);
      setServerW(data.frameWidth);
      setServerH(data.frameHeight);

      if (data.alert) {
        setAlertText(data.alert);
      } else if (data.objects?.length > 0) {
        setAlertText(`Visible: ${Array.from(new Set(data.objects)).join(', ')}`);
      } else {
        setAlertText('Path Clear');
      }

    } catch (err) {
      console.log('Error sending frame:', err);
    }
  };

  if (!permission?.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera permission is required</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const scaleX = SCREEN_WIDTH / serverW;
  const scaleY = SCREEN_HEIGHT / serverH;

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        ref={cameraRef}
        onCameraReady={() => setIsCameraReady(true)}
      >
        <View style={styles.overlay}>
          {detections.map((det, i) => (
            <BoundingBox
              key={`${det.class}-${i}`}
              detection={det}
              scaleX={scaleX}
              scaleY={scaleY}
            />
          ))}
        </View>
      </CameraView>

      <TouchableOpacity style={styles.stopButton} onPress={stopRealtime}>
        <Text style={styles.stopButtonText}>STOP</Text>
      </TouchableOpacity>

      <View
        style={[
          styles.alertBox,
          {
            backgroundColor: alertText.includes('Warning')
              ? 'rgba(220,38,38,0.9)'
              : 'rgba(0,0,0,0.8)',
          },
        ]}
      >
        <Text style={styles.alertText}>{alertText}</Text>
      </View>
    </View>
  );
}

function BoundingBox({
  detection,
  scaleX,
  scaleY
}: {
  detection: Detection;
  scaleX: number;
  scaleY: number;
}) {
  const { bbox, class: className, isPriority, distance } = detection;

  return (
    <View
      style={{
        position: 'absolute',
        left: bbox.x1 * scaleX,
        top: bbox.y1 * scaleY,
        width: (bbox.x2 - bbox.x1) * scaleX,
        height: (bbox.y2 - bbox.y1) * scaleY,
        borderWidth: 2,
        borderColor: isPriority ? '#FF0000' : '#00FF00',
        zIndex: 10,
      }}
    >
      <View
        style={{
          backgroundColor: isPriority ? '#FF0000' : '#00FF00',
          paddingHorizontal: 4,
        }}
      >
        <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
          {className} ({distance})
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },

  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  permissionText: { color: 'white', marginBottom: 20 },

  camera: { flex: 1 },

  overlay: { ...StyleSheet.absoluteFillObject },

  alertBox: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },

  alertText: {
    color: 'white',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  button: { backgroundColor: '#2563EB', padding: 12, borderRadius: 8 },
  buttonText: { color: 'white', fontWeight: 'bold' },

  stopButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'red',
    padding: 14,
    borderRadius: 10,
    zIndex: 20,
  },
  stopButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
