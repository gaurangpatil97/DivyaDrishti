import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Dimensions, TouchableOpacity } from 'react-native';
import { Magnetometer, Accelerometer } from 'expo-sensors';

const { width } = Dimensions.get('window');

export default function MappingTool() {
  const [heading, setHeading] = useState(0);
  const [steps, setSteps] = useState(0);
  const lastPeakTime = useRef(0);
  const consecutiveSteps = useRef(0);

  useEffect(() => {
    Magnetometer.setUpdateInterval(50);
    Accelerometer.setUpdateInterval(50);

    const magSub = Magnetometer.addListener(({ x, y }) => {
      let angle = Math.atan2(y, x) * (180 / Math.PI);
      angle = angle - 90; 
      if (angle < 0) angle += 360;
      setHeading(Math.round(angle));
    });

    const accelSub = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x*x + y*y + z*z);
      const now = Date.now();
      
      if (magnitude > 1.25) {
        if (now - lastPeakTime.current > 350) {
           consecutiveSteps.current += 1;
           if (consecutiveSteps.current >= 2) setSteps(p => p + 1);
           lastPeakTime.current = now;
        }
      } else if (now - lastPeakTime.current > 1500) {
         consecutiveSteps.current = 0; 
      }
    });

    return () => { magSub.remove(); accelSub.remove(); };
  }, []);

  const getDir = (d: number) => ['N','NE','E','SE','S','SW','W','NW'][Math.round(((d%=360)<0?d+360:d)/45)%8];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>INDOOR MAPPING</Text>
      <View style={styles.compassDial}>
        <View style={styles.pointer} />
        <View style={[styles.dialInner, { transform: [{ rotate: `${-heading}deg` }] }]}>
          <Text style={[styles.cardinal, { top: 10, color: '#FF3B30' }]}>N</Text>
          <Text style={[styles.cardinal, { right: 15, top: '45%' }]}>E</Text>
          <Text style={[styles.cardinal, { bottom: 10 }]}>S</Text>
          <Text style={[styles.cardinal, { left: 15, top: '45%' }]}>W</Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.box}>
          <Text style={styles.label}>HEADING</Text>
          <Text style={styles.value}>{heading}°</Text>
          <Text style={styles.sub}>{getDir(heading)}</Text>
        </View>
        <View style={styles.box}>
          <Text style={styles.label}>STEPS</Text>
          <Text style={styles.value}>{steps}</Text>
          <TouchableOpacity onPress={() => setSteps(0)}>
            <Text style={styles.reset}>RESET</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#666', fontSize: 16, fontWeight: 'bold', marginBottom: 40, letterSpacing: 2 },
  compassDial: { width: width * 0.7, height: width * 0.7, borderRadius: width * 0.35, borderWidth: 4, borderColor: '#333', alignItems: 'center', justifyContent: 'center', marginBottom: 50 },
  dialInner: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  pointer: { position: 'absolute', top: -15, zIndex: 10, borderLeftWidth: 10, borderRightWidth: 10, borderBottomWidth: 20, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#FF3B30' },
  cardinal: { position: 'absolute', color: '#fff', fontSize: 24, fontWeight: 'bold' },
  row: { flexDirection: 'row', width: '100%', paddingHorizontal: 20, gap: 15 },
  box: { flex: 1, backgroundColor: '#1C1C1E', borderRadius: 15, padding: 20, alignItems: 'center' },
  label: { color: '#666', fontSize: 12, fontWeight: 'bold' },
  value: { color: '#fff', fontSize: 32, fontWeight: 'bold', marginVertical: 5 },
  sub: { color: '#4CAF50', fontWeight: 'bold' },
  reset: { color: '#FF3B30', fontSize: 10, marginTop: 5, fontWeight: 'bold' }
});