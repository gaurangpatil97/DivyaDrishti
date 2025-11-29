import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

// Get screen width to calculate card size dynamically
const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 50) / 2; // Two columns with padding

export default function Dashboard() {
  const router = useRouter();

  // Define your menu buttons here
  const menuItems = [
    { 
      title: "Indoor Mapping", 
      subtitle: "Steps & Compass", 
      icon: "map", 
      color: "#4CAF50", 
      route: "/(tabs)/mapping" 
    },
    { 
      title: "Obstacle Eye", 
      subtitle: "Camera Detection", 
      icon: "eye", 
      color: "#2196F3", 
      route: "/(tabs)/camera" 
    },
    { 
      title: "Voice Commands", 
      subtitle: "Audio Settings", 
      icon: "mic", 
      color: "#FF9800", 
      route: "/(tabs)/settings" // Placeholder (make this file later)
    },
    { 
      title: "User Profile", 
      subtitle: "History & Stats", 
      icon: "person", 
      color: "#9C27B0", 
      route: "/(tabs)/profile" // Placeholder
    }
    ,{
      title: "Gyroscope",
      subtitle: "Turn Detector",
      icon: "compass",
      color: "#00BCD4",
      route: "/(tabs)/gyroscope"
    }
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 1. HEADER SECTION */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Blind Assist</Text>
        <Text style={styles.headerSubtitle}>Select a module to begin</Text>
      </View>

      {/* 2. GRID SECTION */}
      <View style={styles.grid}>
        {menuItems.map((item, index) => (
          <TouchableOpacity 
            key={index} 
            style={[styles.card, { borderLeftColor: item.color }]}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.7}
          >
            {/* Icon Circle */}
            <View style={[styles.iconBox, { backgroundColor: item.color + '20' }]}>
              {/* @ts-ignore */}
              <Ionicons name={item.icon} size={32} color={item.color} />
            </View>
            
            {/* Text Content */}
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* 3. EXTRA ACTIONS */}
      {/* Gyroscope now opens as a dedicated screen from a card */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#121212' 
  },
  content: {
    paddingBottom: 40 // Extra space at bottom for scrolling
  },
  header: { 
    padding: 30, 
    paddingTop: 60, 
    backgroundColor: '#1E1E1E', 
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    marginBottom: 25
  },
  headerTitle: { 
    color: '#fff', 
    fontSize: 32, 
    fontWeight: 'bold',
    letterSpacing: 1
  },
  headerSubtitle: { 
    color: '#888', 
    fontSize: 16, 
    marginTop: 5 
  },
  
  // GRID STYLES
  grid: { 
    padding: 15,
    gap: 15
  },
  card: {
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    // The colored strip on the left
    borderLeftWidth: 4, 
    // Shadow for iOS
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    // Shadow for Android
    elevation: 8,
  },
  iconBox: { 
    width: 50, 
    height: 50, 
    borderRadius: 25, 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginRight: 15 
  },
  cardContent: { 
    flex: 1 
  },
  cardTitle: { 
    color: '#fff', 
    fontSize: 18, 
    fontWeight: 'bold',
    marginBottom: 2
  },
  cardSubtitle: { 
    color: '#888', 
    fontSize: 13 
  },
});