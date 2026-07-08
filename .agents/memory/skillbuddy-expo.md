---
name: SkillBuddy Expo setup
description: Key architectural decisions and gotchas for the SkillBuddy React Native / Expo app in artifacts/skillbuddy.
---

## react-native-maps web bundler isolation
`react-native-maps@1.18.0` is pinned for Expo Go compatibility. It cannot be imported on the web build — even a dynamic `require()` inside `Platform.OS !== 'web'` is not enough because Metro statically analyzes imports.

**Fix applied:** Platform-specific component files:
- `components/ExploreMap.native.tsx` — real MapView/Marker
- `components/ExploreMap.tsx` — web/fallback placeholder

Import `ExploreMap` from either; Metro picks the right one automatically.

**Why:** Any direct import of `react-native-maps` in a file that the web bundle can reach causes `Importing native-only module "react-native/Libraries/Utilities/codegenNativeCommands"` build failure.

**How to apply:** Whenever adding native-only packages, wrap them in `.native.tsx` component files before importing from shared screens.

## Auth flow hardening
- `login()` in AuthContext now throws if `fetchUser()` returns false after storing tokens. This prevents a half-authenticated state.
- `setSessionExpiredHandler` exported from `services/api.ts` lets AuthContext register a callback that clears `user` state when a 401 refresh fails in the axios interceptor.

## External backend
All API calls go to `https://api.skillbuddy.zeyshan.com`. Auth endpoints are real; service/category/booking data uses mock data from `data/mockData.ts`.

## Package versions (do not auto-upgrade)
- `react-native-maps@1.18.0` — pinned for Expo Go
- `expo-secure-store@57.0.0` — version mismatch warning is benign; works correctly
