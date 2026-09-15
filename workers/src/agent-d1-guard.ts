/** Agent-only protection: does not change Report storage or its authorization. */
type QuotaKV = {get(key: string): Promise<string|null>;
  put(key: string, value: string, options?: {expirationTtl: number}): Promise<unknown>};
const QUOTA_KEY='agent_d1_quota_until:v1';

export function isD1QuotaError(error: unknown): boolean {
  let current=error;
  for(let depth=0;depth<5 && current;depth++) {
    const message=current instanceof Error?current.message:String(current);
    if(/D1_QUOTA_EXCEEDED|free tier daily row (read|write) limit/i.test(message))return true;
    current=current instanceof Error?(current as Error & {cause?: unknown}).cause:undefined;
  }
  return false;
}

export async function withD1QuotaGuard<T>(kv: QuotaKV, run: ()=>Promise<T>, now=Date.now()): Promise<T> {
  const until=Number(await kv.get(QUOTA_KEY));
  if(Number.isFinite(until) && until>now)
    throw new Error(`D1_QUOTA_EXCEEDED: Agent D1 requests paused until ${new Date(until).toISOString()}`);
  try {return await run();}
  catch(error) {
    if(!isD1QuotaError(error))throw error;
    const reset=(Math.floor(now/86400000)+1)*86400000;
    try {await kv.put(QUOTA_KEY,String(reset),{expirationTtl:Math.max(60,Math.ceil((reset-now)/1000))});}
    catch {console.error(JSON.stringify({event:'agent_d1_quota_marker_failed',reset_at:new Date(reset).toISOString()}));}
    // KV propagation is eventual. This reduces repeated known failures; it is
    // NOT an account-wide reservation or a guarantee against quota exhaustion.
    console.error(JSON.stringify({event:'agent_d1_quota_exceeded',reset_at:new Date(reset).toISOString()}));
    throw new Error(`D1_QUOTA_EXCEEDED: Agent D1 requests paused until ${new Date(reset).toISOString()}`);
  }
}

// Cache only successful candidate IDs/counts for an immutable PUBLIC snapshot.
// Never cache reports, authorization, source text, or failures. No KV writes:
// avoid moving the quota problem to a persistent cache. Cold isolates can miss.
const cache=new Map<string,{expiresAt: number; pending: Promise<unknown>}>();
const MAX_ENTRIES=64,TTL_MS=5*60*1000;
export async function cachedSearch<T>(key: string, run: ()=>Promise<T>, now=Date.now()): Promise<{value:T;hit:boolean}> {
  const existing=cache.get(key);
  if(existing && existing.expiresAt>now)return {value:await existing.pending as T,hit:true};
  cache.delete(key);
  if(cache.size>=MAX_ENTRIES)cache.delete(cache.keys().next().value!);
  const pending=Promise.resolve().then(run);
  const entry={expiresAt:now+TTL_MS,pending};
  cache.set(key,entry);
  try {return {value:await pending,hit:false};}
  catch(error){if(cache.get(key)===entry)cache.delete(key);throw error;}
}
