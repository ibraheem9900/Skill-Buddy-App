/**
 * motion.ts
 *
 * ONE animation rule for every popup in the app: a plain opacity fade.
 *
 * Fade in ≈ 200 ms (ease-out); fade out ≈ 150 ms (ease-in); the backdrop dims
 * with the same curve. No slide, no spring, no scale, no bounce, and nothing
 * moves vertically — the surface appears exactly where it will stay, which is
 * what the centred dialogs were missing.
 *
 * The shared popup components (components/BottomSheet, the app alert in
 * context/AlertModalContext, the address pickers in the profile screens) all
 * read these durations, so a new popup inherits the rule by using one of them
 * instead of animating itself.
 *
 * This module deliberately imports NOTHING: it is read by the unit tests in a
 * plain node process, where react-native modules cannot be loaded.
 */

/** Opacity fade-in duration, in milliseconds. */
export const POPUP_FADE_IN_MS = 200;

/** Opacity fade-out duration, in milliseconds. */
export const POPUP_FADE_OUT_MS = 150;
