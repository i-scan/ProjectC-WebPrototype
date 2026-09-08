import {
  BASELINE_THERMAL_PROFILE,
  THERMAL_PROFILE_STORAGE_KEY,
  cloneThermalProfile,
  normalizeThermalProfile,
} from './thermal-profile.js'

let activeProfile = normalizeThermalProfile(BASELINE_THERMAL_PROFILE)
const listeners = new Set()

function emit() {
  for (const listener of listeners) listener()
}

export function getActiveThermalProfile() {
  return activeProfile
}

export function subscribeThermalProfile(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function applyLiveThermalProfile(profile) {
  const next = normalizeThermalProfile(profile)
  next.revision = Math.max(activeProfile.revision + 1, next.revision)
  activeProfile = next
  emit()
  return cloneThermalProfile(activeProfile)
}

export function replaceLiveThermalProfile(profile) {
  activeProfile = normalizeThermalProfile(profile)
  emit()
  return cloneThermalProfile(activeProfile)
}

export function resetLiveThermalProfile() {
  activeProfile = normalizeThermalProfile(BASELINE_THERMAL_PROFILE)
  emit()
  return cloneThermalProfile(activeProfile)
}

export function saveThermalDraft(profile) {
  const normalized = normalizeThermalProfile(profile)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(THERMAL_PROFILE_STORAGE_KEY, JSON.stringify(normalized))
  }
  return cloneThermalProfile(normalized)
}

export function loadThermalDraft() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const raw = window.localStorage.getItem(THERMAL_PROFILE_STORAGE_KEY)
  if (!raw) return null
  try {
    return normalizeThermalProfile(JSON.parse(raw))
  } catch {
    return null
  }
}

export function clearThermalDraft() {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(THERMAL_PROFILE_STORAGE_KEY)
}
