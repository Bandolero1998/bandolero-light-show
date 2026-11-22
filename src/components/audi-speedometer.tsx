import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type AudiSpeedometerProps = {
  speedKmh: number;
  rpm?: number;
  maxSpeed?: number;
  mirrorHud?: boolean;
  size?: number;
};

/**
 * Classic Audi A8 D4 (4H) Analog Speedometer (0 - 280 km/h)
 * Satin black dial, metallic bezel, crisp white numerals, iconic glowing red needle,
 * and center Audi FIS digital readout. Pure React Native (no native SVG dependency).
 */
export function AudiSpeedometer({
  speedKmh,
  rpm,
  maxSpeed = 280,
  mirrorHud = false,
  size = 276,
}: AudiSpeedometerProps) {
  const clampedSpeed = Math.max(0, Math.min(maxSpeed, speedKmh));
  // Dial spans 270 degrees: -135 deg (0 km/h) to +135 deg (280 km/h)
  const startAngleDeg = -135;
  const totalSweepDeg = 270;
  const needleAngleDeg = startAngleDeg + (clampedSpeed / maxSpeed) * totalSweepDeg;

  const radius = size / 2;
  const labelRadius = radius - 37;
  const majorSteps = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280];
  const minorSteps: number[] = [];
  for (let v = 0; v <= maxSpeed; v += 10) {
    minorSteps.push(v);
  }

  return (
    <View
      style={[
        s.outerBezel,
        {
          width: size,
          height: size,
          borderRadius: radius,
          transform: mirrorHud ? [{ scaleX: -1 }] : undefined,
        },
      ]}
    >
      <View
        style={[
          s.dialFace,
          {
            width: size - 12,
            height: size - 12,
            borderRadius: (size - 12) / 2,
          },
        ]}
      >
        {/* Tick marks */}
        {minorSteps.map(val => {
          const isMajor = val % 20 === 0;
          const angleDeg = startAngleDeg + (val / maxSpeed) * totalSweepDeg;
          return (
            <View
              key={`tick-${val}`}
              style={[
                s.tickContainer,
                {
                  width: size - 16,
                  height: size - 16,
                  transform: [{ rotate: `${angleDeg}deg` }],
                },
              ]}
            >
              <View
                style={[
                  s.tick,
                  isMajor ? s.tickMajor : s.tickMinor,
                  val >= 220 && { backgroundColor: '#EF4444' },
                ]}
              />
            </View>
          );
        })}

        {/* Classic white Audi numerals */}
        {majorSteps.map(val => {
          const angleDeg = startAngleDeg + (val / maxSpeed) * totalSweepDeg;
          // 0 deg in our dial is 12 o'clock (top), so convert to radians where 0 rad = right
          const rad = ((angleDeg - 90) * Math.PI) / 180;
          const cx = (size - 12) / 2 + labelRadius * Math.cos(rad);
          const cy = (size - 12) / 2 + labelRadius * Math.sin(rad);
          return (
            <Text
              key={`num-${val}`}
              style={[
                s.numeral,
                {
                  left: cx - 16,
                  top: cy - 8,
                  color: val >= 240 ? '#FCA5A5' : '#F8FAFC',
                },
              ]}
            >
              {val}
            </Text>
          );
        })}

        {/* Subtle Audi A8 D4 branding inside dial */}
        <View style={s.topBadge}>
          <Text style={s.topBadgeText}>AUDI A8 · 4.2 TDI</Text>
        </View>

        {/* Center FIS digital readout */}
        <View style={s.fisBox}>
          <Text style={s.fisSpeed}>{Math.round(clampedSpeed)}</Text>
          <Text style={s.fisUnit}>km/h</Text>
          {rpm !== undefined && (
            <Text style={s.fisRpm}>{Math.round(rpm)} RPM</Text>
          )}
        </View>

        {/* Glowing Red Audi Needle */}
        <View
          style={[
            s.needlePivot,
            {
              width: size - 16,
              height: size - 16,
              transform: [{ rotate: `${needleAngleDeg}deg` }],
            },
          ]}
        >
          <View style={[s.needleBlade, { height: radius - 26 }]} />
        </View>

        {/* Metallic Center Cap */}
        <View style={s.centerCapOuter}>
          <View style={s.centerCapInner} />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outerBezel: {
    backgroundColor: '#27272A',
    borderWidth: 2,
    borderColor: '#71717A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.85,
    shadowRadius: 16,
    elevation: 12,
  },
  dialFace: {
    backgroundColor: '#07080B',
    borderWidth: 1.5,
    borderColor: '#3F3F46',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tickContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  tick: {
    marginTop: 5,
    borderRadius: 1,
  },
  tickMajor: {
    width: 2.5,
    height: 12,
    backgroundColor: '#F8FAFC',
  },
  tickMinor: {
    width: 1.5,
    height: 7,
    backgroundColor: '#71717A',
  },
  numeral: {
    position: 'absolute',
    width: 32,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  topBadge: {
    position: 'absolute',
    top: 66,
  },
  topBadgeText: {
    color: '#9CA3AF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  fisBox: {
    position: 'absolute',
    bottom: 24,
    backgroundColor: '#0D0E12',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
    alignItems: 'center',
    minWidth: 84,
  },
  fisSpeed: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  fisUnit: {
    color: '#9CA3AF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  fisRpm: {
    color: '#EF4444',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },
  needlePivot: {
    position: 'absolute',
    alignItems: 'center',
  },
  needleBlade: {
    width: 3.5,
    backgroundColor: '#EF4444',
    borderRadius: 2,
    marginTop: 18,
    shadowColor: '#EF4444',
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  centerCapOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3F3F46',
    borderWidth: 1.5,
    borderColor: '#A1A1AA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerCapInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#18181B',
  },
});
