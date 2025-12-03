import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
  useMemo,
} from 'react';
import {
  StyleSheet,
  Text,
  View,
  Dimensions,
  Platform,
  TouchableOpacity,
  Alert,
  Vibration,
  FlatList,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import { Feather } from '@expo/vector-icons';

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
  SERVER_URL: 'http://192.168.29.172:5000/detect',
  FRAME_RATE: 10,
  REQUEST_TIMEOUT: 5000,
  RECONNECT_DELAY: 1000,
  IMAGE_QUALITY: 0.15,
  MAX_RETRY_ATTEMPTS: 5,
  SPEECH_COOLDOWN: 3000,
};

// UI Colors
const COLORS = {
  bg: '#0A0E1A',
  card: '#1A1F2E',
  primary: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textMain: '#F9FAFB',
  textSub: '#9CA3AF',
  border: '#252A3A',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

export default function Dashboard() {
  const [permission, requestPermission] = useCameraPermissions();
  const [detections, setDetections] = useState<Detection[]>([]);
  const [alertText, setAlertText] = useState('System Ready');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'error'
  >('connecting');
  const [serverW, setServerW] = useState(1);
  const [serverH, setServerH] = useState(1);

  const cameraRef = useRef<CameraView>(null);

  const runningRef = useRef(false);
  const processingRef = useRef(false);
  const lastSpeechTimeRef = useRef(0);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);
  const frameLoopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAlertTextRef = useRef<string>('System Ready');
  
  // Set initial camera layout based on the flex ratio (3/4 or 75%)
  const [cameraLayout, setCameraLayout] = useState<{ w: number; h: number }>({
    w: SCREEN_WIDTH,
    h: Math.round(SCREEN_HEIGHT * 0.75), 
  });

  // ---------- helpers ----------

  const updateDetections = useCallback((next: Detection[]) => {
    setDetections(prev => {
      if (prev.length === next.length) {
        let same = true;
        for (let i = 0; i < prev.length; i++) {
          const a = prev[i];
          const b = next[i];
          if (
            a.class !== b.class ||
            a.bbox.x1 !== b.bbox.x1 ||
            a.bbox.y1 !== b.bbox.y1 ||
            a.bbox.x2 !== b.bbox.x2 ||
            a.bbox.y2 !== b.bbox.y2
          ) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  }, []);

  const speakAlert = useCallback((text: string) => {
    const now = Date.now();
    if (now - lastSpeechTimeRef.current < CONFIG.SPEECH_COOLDOWN) {
      return;
    }
    lastSpeechTimeRef.current = now;
    Speech.stop();
    Speech.speak(text, {
      language: 'en-US',
      pitch: 1.0,
      rate: 1.05,
    });
  }, []);

  const handleAlerts = useCallback(
    (data: ServerResponse) => {
      let nextAlert = 'Path Clear';
      if (data.alert) {
        nextAlert = data.alert;
      } else if (data.objects?.length > 0) {
        const uniqueObjects = Array.from(new Set(data.objects));
        nextAlert = `${uniqueObjects.slice(0, 2).join(', ')}${uniqueObjects.length > 2 ? '...' : ''} detected`;
      }

      if (nextAlert !== lastAlertTextRef.current) {
        setAlertText(nextAlert);
        lastAlertTextRef.current = nextAlert;
      }

      if (nextAlert.includes('Warning')) {
        Vibration.vibrate([0, 50, 50, 50]);
      }

      if (data.alert) {
        speakAlert(data.alert);
      }
    },
    [speakAlert]
  );

  // ---------- lifecycle / controls ----------

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      runningRef.current = false;
      if (frameLoopTimeoutRef.current) {
        clearTimeout(frameLoopTimeoutRef.current);
      }
      Speech.stop();
    };
  }, []);

  const stopDetection = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    Speech.stop();

    if (frameLoopTimeoutRef.current) {
      clearTimeout(frameLoopTimeoutRef.current);
      frameLoopTimeoutRef.current = null;
    }

    setAlertText('Paused');
    lastAlertTextRef.current = 'Paused';
  }, []);

  const captureAndSendFrame = useCallback(async () => {
    if (!cameraRef.current || processingRef.current || !mountedRef.current) {
      return;
    }

    processingRef.current = true;
    const startTime = Date.now();

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: CONFIG.IMAGE_QUALITY,
        skipProcessing: true,
        base64: false,
        exif: false,
      });

      if (!mountedRef.current) return;

      const formData = new FormData();
      formData.append('image', {
        uri: Platform.OS === 'ios' ? photo.uri.replace('file://', '') : photo.uri,
        type: 'image/jpeg',
        name: 'frame.jpg',
      } as any);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const response = await fetch(CONFIG.SERVER_URL, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data: ServerResponse = await response.json();
      if (!mountedRef.current) return;

      updateDetections(data.detections || []);
      setServerW(data.frameWidth || 1);
      setServerH(data.frameHeight || 1);
      setConnectionStatus('connected');
      retryCountRef.current = 0;

      handleAlerts(data);
    } catch (err: any) {
      if (!mountedRef.current) return;
      
      const isNetworkError = err?.message?.includes('Network') || 
                            err?.message?.includes('Failed to fetch') || 
                            err?.name === 'AbortError';
      
      console.warn('Error sending frame:', err?.message ?? err);
      
      if (isNetworkError) {
        setConnectionStatus('error');
        retryCountRef.current += 1;

        if (retryCountRef.current >= CONFIG.MAX_RETRY_ATTEMPTS) {
          setAlertText('Connection Lost');
          lastAlertTextRef.current = 'Connection Lost';
          stopDetection();
          Alert.alert('Connection Error', 'Unable to reach the AI Server.');
        } else {
          if (lastAlertTextRef.current !== 'Reconnecting...') {
            setAlertText('Reconnecting...');
            lastAlertTextRef.current = 'Reconnecting...';
          }
          await new Promise(resolve => setTimeout(resolve, CONFIG.RECONNECT_DELAY));
        }
      } else {
        // For non-network errors (like processing errors), just skip this frame
        // and don't increment retry count or show reconnecting
        console.warn('Skipping frame due to error:', err?.message);
      }
    } finally {
      processingRef.current = false;
    }
  }, [handleAlerts, stopDetection, updateDetections]);

  const startRealtimeLoop = useCallback(() => {
    const frameDelay = 1000 / CONFIG.FRAME_RATE;
    const loop = async () => {
      if (!runningRef.current || !mountedRef.current) return;
      
      await captureAndSendFrame();
      
      if (runningRef.current && mountedRef.current) {
        // Use setImmediate-like behavior for faster loops
        frameLoopTimeoutRef.current = setTimeout(loop, frameDelay);
      }
    };
    loop();
  }, [captureAndSendFrame]);

  const startDetection = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    retryCountRef.current = 0;
    setIsRunning(true);
    setConnectionStatus('connecting');
    setAlertText('Starting AI...');
    lastAlertTextRef.current = 'Starting AI...';
    startRealtimeLoop();
  }, [startRealtimeLoop]);

  const toggleDetection = useCallback(() => {
    if (isRunning) {
      stopDetection();
    } else {
      startDetection();
    }
  }, [isRunning, startDetection, stopDetection]);

  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (isCameraReady && !hasStartedRef.current) {
      hasStartedRef.current = true;
      startDetection();
    }
  }, [isCameraReady, startDetection]);

  const { scaleX, scaleY } = useMemo(() => {
    const w = Math.max(1, serverW);
    const h = Math.max(1, serverH);
    return {
      scaleX: cameraLayout.w / w,
      scaleY: cameraLayout.h / h,
    };
  }, [serverW, serverH, cameraLayout]);

  // ---------- render ----------

  if (!permission || !permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <View style={styles.permissionIconCircle}>
           <Feather name="camera-off" size={40} color={COLORS.textSub} />
        </View>
        <Text style={styles.permissionText}>Camera Access Needed</Text>
        <Text style={styles.permissionSubtext}>
          We need access to your camera to detect objects and assist with navigation.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      
      {/* --- Main Camera View --- */}
      {/* ADJUSTED: flex 3/1 split so list is visible */}
      <View
        style={styles.cameraContainer}
        onLayout={e => {
            const { width, height } = e.nativeEvent.layout;
            setCameraLayout({ w: width, h: height });
        }}
      >
        <CameraView
          style={styles.camera}
          facing="back"
          ref={cameraRef}
          onCameraReady={() => setIsCameraReady(true)}
        >
          {/* Bounding Boxes Layer */}
          <View style={styles.overlay}>
            {detections.map((det, i) => (
              <BoundingBox
                key={`${det.class}-${det.bbox.x1}-${i}`}
                detection={det}
                scaleX={scaleX}
                scaleY={scaleY}
              />
            ))}
          </View>

          {/* Floating HUD Header (Controls) */}
          <SafeAreaView style={styles.headerSafe}>
            <View style={styles.headerPill}>
                <View style={styles.statusContainer}>
                    <View style={[styles.statusDot, { 
                        backgroundColor: connectionStatus === 'connected' ? COLORS.success : 
                                         connectionStatus === 'error' ? COLORS.danger : COLORS.warning 
                    }]} />
                    <Text style={styles.statusText}>
                        {connectionStatus === 'connected' ? 'ONLINE' : 
                         connectionStatus === 'error' ? 'OFFLINE' : 'SYNCING'}
                    </Text>
                </View>

                <TouchableOpacity 
                    style={[styles.actionButton, isRunning ? styles.btnDanger : styles.btnSuccess]} 
                    onPress={toggleDetection}
                >
                    <Feather name={isRunning ? "pause" : "play"} size={18} color="white" />
                    <Text style={styles.actionButtonText}>{isRunning ? "Pause" : "Start"}</Text>
                </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* Floating Alert Banner - MOVED DOWN */}
          {/* ADJUSTED: Moved to bottom of camera view */}
          <View style={styles.floatingAlertContainer}>
            <View style={[
                styles.floatingAlert, 
                alertText.includes('Warning') && styles.floatingAlertWarning
            ]}>
                <Feather 
                    name={alertText.includes('Warning') ? "alert-triangle" : "activity"} 
                    size={18} 
                    color={alertText.includes('Warning') ? COLORS.danger : COLORS.primary} 
                />
                <Text style={styles.floatingAlertText}>{alertText}</Text>
            </View>
          </View>

        </CameraView>
      </View>

      {/* --- Bottom Dashboard --- */}
      {/* ADJUSTED: More space for the list */}
      <View style={styles.dashboardContainer}>
        <View style={styles.dashboardHeader}>
            <View style={styles.dragHandle} />
            <View style={styles.dashHeaderRow}>
                <Text style={styles.dashTitle}>Live Detections</Text>
                <View style={styles.countBadge}>
                    <Text style={styles.countText}>{detections.length}</Text>
                </View>
            </View>
        </View>

        <FlatList
          data={detections}
          keyExtractor={(item, idx) => `${item.class}-${idx}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={[styles.card, item.isPriority && styles.cardPriority]}>
              <View style={styles.cardIcon}>
                 <Feather 
                    name={item.isPriority ? "alert-circle" : "box"} 
                    size={20} 
                    color={item.isPriority ? COLORS.danger : COLORS.primary} 
                 />
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                    <Text style={styles.cardTitle}>{item.class}</Text>
                    <Text style={styles.cardConfidence}>{Math.round(item.confidence * 100)}%</Text>
                </View>
                <View style={styles.cardBottom}>
                    <Text style={styles.cardMeta}>{item.position}</Text>
                    <Text style={styles.cardDistance}>{item.distance}</Text>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="eye-off" size={24} color={COLORS.textSub} style={{ marginBottom: 8 }} />
              <Text style={styles.emptyText}>No objects in view</Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

// Optimized Bounding Box Component
const BoundingBox = memo(function BoundingBox({
  detection,
  scaleX,
  scaleY,
}: {
  detection: Detection;
  scaleX: number;
  scaleY: number;
}) {
  const { bbox, class: className, isPriority, confidence } = detection;

  const left = bbox.x1 * scaleX;
  const top = bbox.y1 * scaleY;
  const width = (bbox.x2 - bbox.x1) * scaleX;
  const height = (bbox.y2 - bbox.y1) * scaleY;

  const color = isPriority ? COLORS.danger : COLORS.success;

  return (
    <View
        style={{
            position: 'absolute',
            left,
            top,
            width,
            height,
            borderWidth: 2,
            borderColor: color,
            borderRadius: 8,
            zIndex: 10,
        }}
    >
      <View style={{
          position: 'absolute',
          top: -24,
          left: -2,
          backgroundColor: color,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4
      }}>
        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 10 }}>
            {className.toUpperCase()}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10 }}>
            {Math.round(confidence * 100)}%
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  
  // Camera Section
  cameraContainer: {
    flex: 2, // 60% of screen height (gives 40% to list)
    backgroundColor: '#000',
    overflow: 'hidden',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },

  // Floating Header
  headerSafe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  headerPill: {
    marginHorizontal: 16,
    marginTop: Platform.OS === 'android' ? 40 : 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(26, 31, 46, 0.95)',
    borderRadius: 50,
    padding: 6,
    paddingLeft: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 40,
  },
  btnSuccess: { backgroundColor: COLORS.primary },
  btnDanger: { backgroundColor: COLORS.danger },
  actionButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 6,
  },

  // Floating Alert - UPDATED
  floatingAlertContainer: {
    position: 'absolute',
    bottom: 20, // Sticks to the bottom of the Camera View
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 15,
  },
  floatingAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26, 31, 46, 0.98)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  floatingAlertWarning: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  floatingAlertText: {
    color: COLORS.textMain,
    fontWeight: '600',
    fontSize: 14,
  },

  // Dashboard / Bottom Sheet
  dashboardContainer: {
    flex: 1.3, // 40% of screen height - more space for cards
    backgroundColor: COLORS.bg,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  dashboardHeader: {
    marginBottom: 12,
    alignItems: 'center',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    marginBottom: 12,
  },
  dashHeaderRow: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dashTitle: {
    color: COLORS.textMain,
    fontSize: 16,
    fontWeight: 'bold',
  },
  countBadge: {
    backgroundColor: '#1E3A8A',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  countText: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },

  // List Items
  listContent: {
    paddingBottom: 16,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  cardPriority: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.danger,
    backgroundColor: '#2A1A1E',
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#252A3A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cardBody: {
    flex: 1,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: {
    color: COLORS.textMain,
    fontWeight: '600',
    fontSize: 15,
  },
  cardConfidence: {
    color: COLORS.success,
    fontWeight: '700',
    fontSize: 12,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardMeta: {
    color: COLORS.textSub,
    fontSize: 12,
  },
  cardDistance: {
    color: COLORS.textSub,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 20,
    opacity: 0.5,
  },
  emptyText: {
    color: COLORS.textSub,
  },

  // Permission Screen
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    padding: 30,
  },
  permissionIconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: COLORS.card,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
  },
  permissionText: {
    color: COLORS.textMain,
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  permissionSubtext: {
    color: COLORS.textSub,
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 22,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
});