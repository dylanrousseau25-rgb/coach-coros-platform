import baseRouter from './router.mjs';
import { startCorosOAuth, finishCorosOAuth, corosStatus, disconnectCoros, overlayCorosDashboard, hasCorosConnection, readCorosCache } from './coros-mcp.mjs';
import { syncCorosV2 } from './coros-sync-v2.mjs';
import { enhanceCorosSync } from './coros-extras.mjs';
import { loadRecentCorosActivityRefs } from './coros-recent.mjs';
import { reconcileCorosActivities, auditPocState, restorePocExtras } from './poc-reconcile.mjs';

function json(body,status=200,cookies=[]){const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});for(const v of cookies)headers.append('set-cookie',v);return new Response(JSON.stringify(body),{status,headers});}
function redirect(location,cookies=[]){const headers=new Headers({location,'cache-control':'no-store'});for(const v of cookies)headers.append('set-cookie',v);return new Response(null,{status:302,headers});}
async function baseDashboard(request){const url=new URL(request.url),req=new Request(`${url.origin}/api/router?path=dashboard`,{method:'GET',headers:request.headers}),response=await baseRouter.fetch(req),data=await response.json();if(!response.ok)throw new Error(data?.error||`Dashboard ${response.status}`);return data;}
async function liveDashboard(request){return overlayCorosDashboard(await baseDashboard(request),request);}
async function injectFitnessContext(request){if(!hasCorosConnection(request))return request;const dashboard=await liveDashboard(request);if(dashboard.meta?.corosMode!=='mcp')return request;const payload=await request.json().catch(()=>({}));payload._fitnessContext={metrics:dashboard.metrics||{},heartRateZones:dashboard.heartRateZones||{},latestActivity:dashboard.latestActivity||null,recentFeedback:(dashboard.feedback||[]).slice(0,12),corosLastSyncAt:dashboard.meta?.corosLastSyncAt||null};return new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(payload)});}
async function liveCoachReply(data,message){if(!process.env.OPENAI_API_KEY)return null;const context={athlete:data.athlete,heartRateZones:data.heartRateZones,metrics:data.metrics,dataFreshness:{today:data.meta?.today,corosLive:data.meta?.corosMode==='mcp',lastSyncAt:data.meta?.corosLastSyncAt||null},activeObjective:data.activeObjective,activePlan:data.activePlan,todaySession:data.todaySession,latestActivity:data.latestActivity,recentFeedback:(data.feedback||[]).slice(0,8),planPreferences:data.activePlan?.preferences||null};const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',reasoning:{effort:'low'},input:`Tu es Coach COROS, coach d'endurance prudent et collaboratif.\nContexte JSON:\n${JSON.stringify(context)}\nMessage de l'athlète: ${message}\nRéponds en français, de façon concise et pratique. Utilise uniquement les métriques COROS quand elles sont live. Explique les compromis quand l'athlète veut modifier le plan : il reste décisionnaire, mais tu dois signaler clairement une modification que tu déconseilles. Prévention des blessures avant la performance.`})});if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);const payload=await response.json();return(payload.output||[]).flatMap(i=>i.content||[]).filter(i=>i.type==='output_text').map(i=>i.text).join('\n').trim()||'Pas de réponse.';}

export default{async fetch(request){const url=new URL(request.url),route=url.searchParams.get('path')||'',method=request.method.toUpperCase();try{
if(method==='GET'&&route==='coros/connect'){const result=await startCorosOAuth(request);return redirect(result.location,result.setCookies);}
if(method==='GET'&&route==='coros/callback'){const result=await finishCorosOAuth(request);return redirect(result.location,result.setCookies);}
if(method==='GET'&&route==='coros/status')return json(corosStatus(request));
if(method==='POST'&&route==='coros/sync'){
  const result=await enhanceCorosSync(request,await syncCorosV2(request));
  let reconciliation={matchedCount:0,unmatched:0};
  try{
    const recentActivities=await loadRecentCorosActivityRefs(request,result,{days:14,limit:30});
    reconciliation=await reconcileCorosActivities(recentActivities);
    result.cache.diagnostics={...(result.cache.diagnostics||{}),reconciliation:{recentActivities:recentActivities.length,matched:reconciliation.matchedCount||0}};
  }catch(error){
    reconciliation={matchedCount:0,skipped:true,error:String(error?.message||error||'Rapprochement indisponible').slice(0,160)};
    console.warn('[COROS reconcile]',reconciliation.error);
  }
  return json({ok:true,syncedAt:result.cache.syncedAt,dataDate:result.cache.date,errors:result.cache.errors,diagnostics:result.cache.diagnostics,reconciliation},200,result.setCookies);
}
if(method==='POST'&&route==='coros/disconnect')return json({ok:true},200,disconnectCoros());
if(method==='GET'&&route==='dashboard'){const baseResponse=await baseRouter.fetch(request),base=await baseResponse.json();if(!baseResponse.ok)return json(base,baseResponse.status);return json(overlayCorosDashboard(base,request));}
if(method==='GET'&&route==='poc/audit')return json(await auditPocState());
if(method==='POST'&&route==='plans/continuity/restore'){
  const payload=await request.json().catch(()=>({}));
  await restorePocExtras(payload);
  const forwarded=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(payload)});
  return baseRouter.fetch(forwarded);
}
const planMutation=method==='POST'&&(route==='objectives'||/^objectives\/[^/]+\/regenerate$/.test(route)||/^plans\/[^/]+\/preferences\/propose$/.test(route)||/^plans\/[^/]+\/weekly-review$/.test(route));if(planMutation){const enriched=await injectFitnessContext(request);return baseRouter.fetch(enriched);}
if(method==='POST'&&route==='coach'&&hasCorosConnection(request)){const cache=readCorosCache(request),dashboard=await liveDashboard(request);if(dashboard.meta?.corosMode==='mcp'&&cache){const{message}=await request.json();if(!message?.trim())return json({error:'Message vide'},400);const reply=await liveCoachReply(dashboard,message.trim());if(reply)return json({reply});}}
return baseRouter.fetch(request);}catch(error){if(route==='coros/callback')return redirect(`/?coros=error&message=${encodeURIComponent(error?.message||'Connexion COROS impossible')}`);if(route.startsWith('coros/'))return json({error:error?.message||'Erreur COROS'},route==='coros/sync'?502:500);return json({error:error?.message||'Erreur serveur'},500);}}};
