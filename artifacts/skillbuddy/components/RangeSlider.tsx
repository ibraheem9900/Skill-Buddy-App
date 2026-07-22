import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onChange: (min: number, max: number) => void;
  step?: number;
}

const TRACK_WIDTH = 220;
const THUMB_SIZE = 22;

export default function RangeSlider({ min, max, valueMin, valueMax, onChange, step = 5 }: Props) {
  const { colors: c } = useTheme();
  const range = max - min;

  const valueToX = (v: number) => ((v - min) / range) * TRACK_WIDTH;
  const xToValue = (x: number) => {
    const raw = min + (x / TRACK_WIDTH) * range;
    return Math.round(raw / step) * step;
  };

  const [minX, setMinX] = useState(valueToX(valueMin));
  const [maxX, setMaxX] = useState(valueToX(valueMax));
  const minXRef = useRef(minX);
  const maxXRef = useRef(maxX);
  minXRef.current = minX;
  maxXRef.current = maxX;

  const minPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        const startX = valueToX(valueMin);
        let next = startX + gesture.dx;
        next = Math.max(0, Math.min(next, maxXRef.current - THUMB_SIZE / 2));
        setMinX(next);
      },
      onPanResponderRelease: () => {
        const newVal = Math.max(min, xToValue(minXRef.current));
        onChange(newVal, xToValue(maxXRef.current));
      },
    })
  ).current;

  const maxPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        const startX = valueToX(valueMax);
        let next = startX + gesture.dx;
        next = Math.min(TRACK_WIDTH, Math.max(next, minXRef.current + THUMB_SIZE / 2));
        setMaxX(next);
      },
      onPanResponderRelease: () => {
        const newVal = Math.min(max, xToValue(maxXRef.current));
        onChange(xToValue(minXRef.current), newVal);
      },
    })
  ).current;

  return (
    <View style={styles.wrap}>
      <View style={[styles.track, { backgroundColor: c.border }]} />
      <View
        style={[
          styles.fill,
          { backgroundColor: c.primary, left: minX, width: Math.max(0, maxX - minX) },
        ]}
      />
      <View
        style={[styles.thumb, { left: minX - THUMB_SIZE / 2, backgroundColor: '#FFF', borderColor: c.primary }]}
        {...minPanResponder.panHandlers}
      />
      <View
        style={[styles.thumb, { left: maxX - THUMB_SIZE / 2, backgroundColor: '#FFF', borderColor: c.primary }]}
        {...maxPanResponder.panHandlers}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: TRACK_WIDTH, height: THUMB_SIZE, justifyContent: 'center' },
  track: { position: 'absolute', height: 4, borderRadius: 2, width: TRACK_WIDTH },
  fill: { position: 'absolute', height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2.5,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  },
});
