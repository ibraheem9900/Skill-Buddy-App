import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeTimeSlots, type ApiTimeSlot } from '@/lib/apiTimeSlots';
import { setClientSlots } from '@/lib/timeSlots';
import { fetchTimeSlots } from '@/services/timeSlots';

const CACHE_KEY = 'sb_time_slots_v1';

type Status = 'idle' | 'loading' | 'ready' | 'error';

let memory: ApiTimeSlot[] = [];
let memoryStatus: Status = 'idle';

/** One app-wide owner: API first, last good persisted copy on failure. */
export function useTimeSlots() {
  const [slots, setSlots] = useState<ApiTimeSlot[]>(memory);
  const [status, setStatus] = useState<Status>(memoryStatus);
  const inFlight = useRef(false);

  const adopt = useCallback((next: ApiTimeSlot[]) => {
    memory = next;
    memoryStatus = next.length > 0 ? 'ready' : 'error';
    setSlots(next);
    setStatus(memoryStatus);
    setClientSlots(next);
    if (next.length > 0) void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
  }, []);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && memoryStatus === 'ready' && memory.length > 0) {
      setClientSlots(memory);
      setSlots(memory);
      setStatus('ready');
      return;
    }
    inFlight.current = true;
    setStatus(memory.length > 0 ? 'ready' : 'loading');
    try {
      const fresh = await fetchTimeSlots();
      if (fresh.length === 0) throw new Error('empty time slots');
      adopt(fresh);
    } catch {
      if (memory.length > 0) {
        setClientSlots(memory);
        setSlots(memory);
        setStatus('ready');
      } else {
        try {
          const cached = normalizeTimeSlots(JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) ?? '[]'));
          if (cached.length > 0) {
            adopt(cached);
            setStatus('ready');
          } else {
            memoryStatus = 'error';
            setStatus('error');
          }
        } catch {
          memoryStatus = 'error';
          setStatus('error');
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [adopt]);

  useEffect(() => { void load(); }, [load]);

  return { slots, status, load, refresh: () => load(true) };
}

export default useTimeSlots;
