import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Gyroscope } from 'expo-sensors';

export default function TurnDetector() {
  const [currentAction, setCurrentAction] = useState('STRAIGHT ⬆️');
  const [debugAngle, setDebugAngle] = useState(0);

  const accumulatedAngle = useRef(0);
  const lastTimestamp = useRef(Date.now());

  const TURN_THRESHOLD = 45; // degrees

  useEffect(() => {
    Gyroscope.setUpdateInterval(50);

    const subscription = Gyroscope.addListener(({ z }) => {
      const now = Date.now();
      const dt = (now - lastTimestamp.current) / 1000; // seconds
      lastTimestamp.current = now;

      const degreesTurned = z * (180 / Math.PI) * dt; // rad/s to deg
      accumulatedAngle.current += degreesTurned;
      setDebugAngle(Math.round(accumulatedAngle.current));

      if (accumulatedAngle.current > TURN_THRESHOLD) {
        setCurrentAction('TURNED LEFT ⬅️');
        accumulatedAngle.current = 0;
        setTimeout(() => setCurrentAction('STRAIGHT ⬆️'), 2000);
      } else if (accumulatedAngle.current < -TURN_THRESHOLD) {
        setCurrentAction('TURNED RIGHT ➡️');
        accumulatedAngle.current = 0;
        setTimeout(() => setCurrentAction('STRAIGHT ⬆️'), 2000);
      }
    });

    return () => subscription.remove();
  }, []);

  const getBgColor = () => {
    if (currentAction.includes('LEFT')) return '#d32f2f';
    if (currentAction.includes('RIGHT')) return '#388e3c';
    return '#121212';
  };

  return (
    <View style={[styles.container, { backgroundColor: getBgColor() }]}>
      <Text style={styles.label}>STATUS</Text>
      <Text style={styles.actionText}>{currentAction}</Text>

      <View style={styles.debugBox}>
        <Text style={styles.smallText}>Accumulated Angle:</Text>
        <Text style={styles.angleText}>{debugAngle}°</Text>
        <Text style={styles.hintText}>(Hit +/- {TURN_THRESHOLD}° to trigger turn)</Text>
      </View>

      <TouchableOpacity
        style={styles.resetBtn}
        onPress={() => {
          accumulatedAngle.current = 0;
          setCurrentAction('STRAIGHT ⬆️');
        }}
      >
        <Text style={styles.btnText}>Reset Center</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 20, marginBottom: 10, fontWeight: 'bold' },
  actionText: { color: '#fff', fontSize: 50, fontWeight: 'bold', textAlign: 'center', marginBottom: 50 },

  debugBox: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', padding: 20, borderRadius: 15 },
  smallText: { color: '#ccc', fontSize: 16 },
  angleText: { color: '#fff', fontSize: 40, fontWeight: 'bold', marginVertical: 10 },
  hintText: { color: '#aaa', fontSize: 12 },

  resetBtn: { marginTop: 40, padding: 15, backgroundColor: 'white', borderRadius: 30, minWidth: 150, alignItems: 'center' },
  btnText: { color: 'black', fontWeight: 'bold', fontSize: 16 },
});
