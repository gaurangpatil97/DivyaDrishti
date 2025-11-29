import React from 'react';
import { StyleSheet, View } from 'react-native';
import TurnDetector from '../../components/ui/gyroscope';

export default function GyroscopeScreen() {
  return (
    <View style={styles.container}>
      <TurnDetector />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
});
