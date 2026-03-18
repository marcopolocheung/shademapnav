import SunCalc from 'suncalc';

self.onmessage = (e: MessageEvent<{ lat: number; lon: number; timestamp: number }>) => {
  const { lat, lon, timestamp } = e.data;
  const sun = SunCalc.getPosition(new Date(timestamp), lat, lon);
  self.postMessage({
    azimuthDeg: sun.azimuth * 180 / Math.PI,
    altitudeDeg: sun.altitude * 180 / Math.PI,
    azimuthRad: sun.azimuth,
    altitudeRad: sun.altitude,
  });
};
