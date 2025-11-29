import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Dimensions,
  Platform,
  TouchableOpacity,
  Alert,
  Vibration,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';

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

// Configuration
const CONFIG = {
  SERVER_URL: 'http://192.168.31.185:5000/detect',
  FRAME_RATE: 3, // FPS
  REQUEST_TIMEOUT: 5000, // ms
  RECONNECT_DELAY: 2000, // ms
  IMAGE_QUALITY: 0.4,
  MAX_RETRY_ATTEMPTS: 3,
  SPEECH_COOLDOWN: 3000, // ms between speech announcements
};

export default function Dashboard() {
  const [permission, requestPermission] = useCameraPermissions();
  
  const [detections, setDetections] = useState<Detection[]>([]);
  const [alertText, setAlertText] = useState('Initializing...');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [frameCount, setFrameCount] = useState(0);
  
  const [serverW, setServerW] = useState(1);
  const [serverH, setServerH] = useState(1);

  const cameraRef = useRef<CameraView>(null);
  const runningRef = useRef(false);
  const processingRef = useRef(false);
  const lastSpeechTimeRef = useRef(0);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      runningRef.current = false;
      Speech.stop();
    };
  }, []);

  // Auto-start when camera is ready
  useEffect(() => {
    if (isCameraReady && !isRunning) {
      startDetection();
    }
  }, [isCameraReady]);

  const startDetection = useCallback(() => {
    if (runningRef.current) return;
    
    runningRef.current = true;
    setIsRunning(true);
    setConnectionStatus('connecting');
    startRealtimeLoop();
  }, []);

  const stopDetection = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    Speech.stop();
    setAlertText('Detection Stopped');
  }, []);

  const toggleDetection = useCallback(() => {
    if (isRunning) {
      stopDetection();
    } else {
      startDetection();
    }
  }, [isRunning, startDetection, stopDetection]);

  const startRealtimeLoop = async () => {
    const frameDelay = 1000 / CONFIG.FRAME_RATE;
    
    while (runningRef.current && mountedRef.current) {
      const startTime = Date.now();
      
      await captureAndSendFrame();
      
      // Maintain consistent frame rate
      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(0, frameDelay - elapsed);
      
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  };

  const captureAndSendFrame = async () => {
    if (!cameraRef.current || processingRef.current || !mountedRef.current) {
      return;
    }

    processingRef.current = true;

    try {
      // Capture photo
      const photo = await cameraRef.current.takePictureAsync({
        quality: CONFIG.IMAGE_QUALITY,
        skipProcessing: true,
        base64: false,
      });

      if (!mountedRef.current) return;

      // Prepare form data
      const formData = new FormData();
      formData.append('image', {
        uri: Platform.OS === 'ios' ? photo.uri.replace('file://', '') : photo.uri,
        type: 'image/jpeg',
        name: 'frame.jpg',
      } as any);

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      // Send to server
      const response = await fetch(CONFIG.SERVER_URL, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data: ServerResponse = await response.json();

      if (!mountedRef.current) return;

      // Update state
      setDetections(data.detections || []);
      setServerW(data.frameWidth || 1);
      setServerH(data.frameHeight || 1);
      setConnectionStatus('connected');
      setFrameCount(prev => prev + 1);
      retryCountRef.current = 0; // Reset retry count on success

      // Handle alerts
      handleAlerts(data);

    } catch (err: any) {
      console.error('Error sending frame:', err.message);
      
      if (!mountedRef.current) return;

      setConnectionStatus('error');
      retryCountRef.current++;

      // Stop if max retries reached
      if (retryCountRef.current >= CONFIG.MAX_RETRY_ATTEMPTS) {
        setAlertText('Connection lost. Please check server.');
        stopDetection();
        
        Alert.alert(
          'Connection Error',
          'Unable to connect to detection server. Please verify the server is running and the IP address is correct.',
          [{ text: 'OK' }]
        );
      } else {
        setAlertText('Reconnecting...');
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, CONFIG.RECONNECT_DELAY));
      }
    } finally {
      processingRef.current = false;
    }
  };

  const handleAlerts = (data: ServerResponse) => {
    if (data.alert) {
      setAlertText(data.alert);
      
      // Vibrate for priority alerts
      if (data.alert.includes('Warning')) {
        Vibration.vibrate([0, 200, 100, 200]);
      }
      
      // Speak alert with cooldown
      speakAlert(data.alert);
      
    } else if (data.objects?.length > 0) {
      const uniqueObjects = Array.from(new Set(data.objects));
      setAlertText(`Visible: ${uniqueObjects.join(', ')}`);
    } else {
      setAlertText('Path Clear');
    }
  };

  const speakAlert = (text: string) => {
    const now = Date.now();
    
    // Cooldown check
    if (now - lastSpeechTimeRef.current < CONFIG.SPEECH_COOLDOWN) {
      return;
    }
    
    lastSpeechTimeRef.current = now;
    
    // Stop any ongoing speech
    Speech.stop();
    
    // Speak the alert
    Speech.speak(text, {
      language: 'en-US',
      pitch: 1.0,
      rate: 1.1,
    });
  };

  if (!permission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Loading...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>📷 Camera Permission Required</Text>
        <Text style={styles.permissionSubtext}>
          This app needs camera access to detect objects and assist navigation.
        </Text>
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
              key={`${det.class}-${i}-${frameCount}`}
              detection={det}
              scaleX={scaleX}
              scaleY={scaleY}
            />
          ))}
        </View>
      </CameraView>

      {/* Status Indicator */}
      <View style={styles.statusContainer}>
        <View style={[
          styles.statusDot,
          { backgroundColor: connectionStatus === 'connected' ? '#22C55E' : connectionStatus === 'error' ? '#EF4444' : '#F59E0B' }
        ]} />
        <Text style={styles.statusText}>
          {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'error' ? 'Error' : 'Connecting'}
        </Text>
        <Text style={styles.fpsText}>• {CONFIG.FRAME_RATE} FPS</Text>
      </View>

      {/* Control Buttons */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity 
          style={[styles.controlButton, isRunning ? styles.stopButton : styles.startButton]} 
          onPress={toggleDetection}
        >
          <Text style={styles.controlButtonText}>
            {isRunning ? '⏸ PAUSE' : '▶ START'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Alert Box */}
      <View
        style={[
          styles.alertBox,
          {
            backgroundColor: alertText.includes('Warning')
              ? 'rgba(220,38,38,0.95)'
              : alertText.includes('Clear')
              ? 'rgba(34,197,94,0.9)'
              : 'rgba(0,0,0,0.85)',
          },
        ]}
      >
        <Text style={styles.alertText}>{alertText}</Text>
        {detections.length > 0 && (
          <Text style={styles.detectionCount}>
            {detections.length} object{detections.length !== 1 ? 's' : ''} detected
          </Text>
        )}
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
  const { bbox, class: className, isPriority, distance, confidence } = detection;

  return (
    <View
      style={{
        position: 'absolute',
        left: bbox.x1 * scaleX,
        top: bbox.y1 * scaleY,
        width: (bbox.x2 - bbox.x1) * scaleX,
        height: (bbox.y2 - bbox.y1) * scaleY,
        borderWidth: 3,
        borderColor: isPriority ? '#EF4444' : '#22C55E',
        borderRadius: 4,
        zIndex: 10,
      }}
    >
      <View
        style={{
          backgroundColor: isPriority ? '#EF4444' : '#22C55E',
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
        }}
      >
        <Text style={{ color: 'white', fontSize: 11, fontWeight: 'bold' }}>
          {className}
        </Text>
        <Text style={{ color: 'white', fontSize: 9 }}>
          {distance} • {Math.round(confidence * 100)}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: 'black' 
  },

  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 20,
  },
  permissionText: { 
    color: 'white', 
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionSubtext: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },

  camera: { 
    flex: 1 
  },

  overlay: { 
    ...StyleSheet.absoluteFillObject 
  },

  statusContainer: {
    position: 'absolute',
    top: 50,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  fpsText: {
    color: '#9CA3AF',
    fontSize: 12,
    marginLeft: 4,
  },

  controlsContainer: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 20,
  },
  controlButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  startButton: {
    backgroundColor: '#22C55E',
  },
  stopButton: {
    backgroundColor: '#EF4444',
  },
  controlButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },

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
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  detectionCount: {
    color: '#D1D5DB',
    fontSize: 12,
    marginTop: 4,
  },

  button: { 
    backgroundColor: '#3B82F6', 
    paddingHorizontal: 24,
    paddingVertical: 12, 
    borderRadius: 12,
    elevation: 3,
  },
  buttonText: { 
    color: 'white', 
    fontWeight: 'bold',
    fontSize: 16,
  },
});