function sampleValue(data, index) {
  if (data instanceof Float32Array || data instanceof Float64Array) return data[index];
  if (data instanceof Int16Array) return data[index] / 32768;
  return null;
}

export function measureAudioLevel(frame) {
  const data = frame?.data;
  if (!ArrayBuffer.isView(data) || data.byteLength < 2) return null;

  const floatSamples = data instanceof Float32Array || data instanceof Float64Array;
  const intSamples = data instanceof Int16Array;
  const byteView = !floatSamples && !intSamples && data.BYTES_PER_ELEMENT === 1
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : null;
  if (!floatSamples && !intSamples && !byteView) return null;

  const length = floatSamples || intSamples ? data.length : Math.floor(data.byteLength / 2);
  const stride = Math.max(1, Math.floor(length / 2400));
  let sum = 0, count = 0;
  for (let i = 0; i < length; i += stride) {
    const sample = byteView
      ? byteView.getInt16(i * 2, true) / 32768
      : sampleValue(data, i);
    if (!Number.isFinite(sample)) continue;
    sum += sample * sample;
    count++;
  }
  if (count === 0) return null;
  return Math.min(1, Math.sqrt(sum / count) * 3);
}

export function attachAudioLevelMeter(output, onLevel) {
  if (!output || typeof output.captureFrame !== 'function' || typeof onLevel !== 'function') return false;
  const original = output.captureFrame;
  const wrapped = function captureFrameWithMeter(frame) {
    const level = measureAudioLevel(frame);
    if (level !== null) onLevel(level);
    return original.call(this, frame);
  };
  try {
    output.captureFrame = wrapped;
    return output.captureFrame === wrapped;
  } catch {
    return false;
  }
}
