export function deleteTeachingUnit(units = [], courses = [], unitId = "", { allowDemo = false } = {}) {
  const index = units.findIndex(unit => unit?.id === unitId && (allowDemo || !unit?.isDemo));
  if (index < 0) return { deleted: false, units, courses, removed: null };
  const removed = units[index];
  return {
    deleted: true,
    removed,
    units: units.filter((_, unitIndex) => unitIndex !== index),
    courses: courses.map(course => ({
      ...course,
      unitOrder: Array.isArray(course.unitOrder) ? course.unitOrder.filter(id => id !== unitId) : course.unitOrder,
    })),
  };
}
