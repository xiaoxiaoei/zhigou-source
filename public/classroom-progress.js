const prefix = 'zhigou:classroom-progress:';
const signature = unit => JSON.stringify(unit.lesson?.flow || []);

export function saveClassroomProgress(storage, unit, seconds) {
  if (!unit?.id || !Number.isFinite(seconds)) return false;
  try {
    storage.setItem(prefix + unit.id, JSON.stringify({ signature: signature(unit), seconds: Math.max(0, seconds) }));
    return true;
  } catch { return false; }
}

export function loadClassroomProgress(storage, unit) {
  if (!unit?.id) return 0;
  try {
    const saved = JSON.parse(storage.getItem(prefix + unit.id));
    return saved?.signature === signature(unit) && Number.isFinite(saved.seconds) && saved.seconds >= 0 ? saved.seconds : 0;
  } catch { return 0; }
}
