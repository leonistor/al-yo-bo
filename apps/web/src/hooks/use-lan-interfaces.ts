import { useQuery } from '@tanstack/react-query';

import { fetchLanInterfaces } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Local network interfaces exposed by the server. The client uses these names
 * and addresses together with `window.location` to build reachable LAN URLs.
 */
export function useLanInterfaces() {
  return useQuery({
    queryKey: queryKeys.lan,
    queryFn: fetchLanInterfaces,
  });
}
