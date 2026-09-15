"use client"
import { useEffect, useRef, useState } from "react"
import { listJobsIfChanged, createJob, createBatch, getJob, cancelJob, removeJob, restoreJob, clearJobs, API_BASE } from "@/lib/api"
import type { Job, JobListItem, JobMethod, JobStatus, JobTask, PsiMethod } from "@/shared/schemas/job"
import { useViewer } from "@/lib/hooks/useViewer"
import { useJobStream } from "@/lib/hooks/useJobStream"
import { isTrajectoryTask } from "@/lib/xyz"
import { runPool } from "@/lib/pool"
import JobList from "@/app/components/JobList"
import SubmitForm from "@/app/components/SubmitForm"
import Viewer3D from "@/app/components/Viewer3D"
import HeaderTabs, { TAB_KEYS, type TabKey } from "@/app/components/HeaderTabs"
import JobBoard from "@/app/components/JobBoard"
import XyzPanel from "@/app/components/XyzPanel"
import LogPanel from "@/app/components/LogPanel"
import BatchPanel from "@/app/components/BatchPanel"

export default function Page(){
  const [xyz,setXyz]=useState("")
  const [task,setTask]=useState<JobTask>("opt")
  const [method,setMethod]=useState<JobMethod>("gfn2")
  const [charge,setCharge]=useState(0)
  const [threads,setThreads]=useState(8)
  const [psiMethod,setPsiMethod]=useState<PsiMethod>("b3lyp")
  const [psiBasis,setPsiBasis]=useState("def2-SVP")
  const [multiplicity,setMultiplicity]=useState(1)
  const [jobs,setJobs]=useState<JobListItem[]>([])
  const [cur,setCur]=useState<Job|null>(null)
  const [msg,setMsg]=useState("")
  const [dark,setDark]=useState(false)
  const [sideOpen,setSideOpen]=useState(true)
  const [tab,setTab]=useState<TabKey>("view3d")
  const { viewerElRef, ready, frames, frame, viewerErr, debug, initViewer, setBackground, renderXyz, play, pause, reset, goToFrame } = useViewer()
  // 运行中任务走 SSE 实时补丁；结束时拉一次全量（补 result_xyz），非运行态不订阅
  useJobStream(cur && (cur.status === "queued" || cur.status === "running") ? cur.id : null, {
    onData: (p)=>setCur((prev)=>prev && prev.id===p.id ? {...prev, status:p.status, result_energy:p.result_energy ?? prev.result_energy, wall_time:p.wall_time ?? prev.wall_time, result_log:p.result_log ?? prev.result_log, progress_energy:p.progress_energy ?? prev.progress_energy, progress_xyz:p.progress_xyz ?? prev.progress_xyz} : prev),
    onTerminal: async (id)=>{ try{ const j=await getJob(id); setCur((prev)=>prev && prev.id===id ? j : prev); loadJobs() }catch{} },
  })

  useEffect(()=>{ if(window.innerWidth<768) setSideOpen(false) },[])
  // ?tab=jobs 直接打开指定标签页（便于分享链接）
  useEffect(()=>{ const t=new URLSearchParams(window.location.search).get("tab") as TabKey|null; if(t && TAB_KEYS.includes(t)) setTab(t) },[])
  useEffect(()=>{ const t=localStorage.getItem("theme"); if(t==="dark"){document.documentElement.classList.add("dark"); setDark(true)} },[])
  const toggleDark=()=>{
    const nd=!dark; setDark(nd)
    document.documentElement.classList.toggle("dark", nd)
    localStorage.setItem("theme", nd?"dark":"light")
    setBackground(nd)
  }

  const [trash,setTrash]=useState<JobListItem[]>([])
  const [batchFocus,setBatchFocus]=useState<{id:string;n:number}|null>(null)
  // 条件请求：列表没变时服务端回 304，不替换数组引用（任务页/侧边栏不重新分组、不重渲染）
  const etagRef=useRef<{jobs:string|null; trash:string|null}>({jobs:null, trash:null})
  const loadJobs=async()=>{ try{ const [a,b]=await Promise.all([listJobsIfChanged(false, etagRef.current.jobs), listJobsIfChanged(true, etagRef.current.trash)]); if(a.items){ setJobs(a.items); etagRef.current.jobs=a.etag } if(b.items){ setTrash(b.items); etagRef.current.trash=b.etag } }catch(e){ console.error(e) } }
  // 克隆重跑：当前任务参数回填表单
  const cloneCur=()=>{ if(!cur) return; const c=cur; setXyz(c.input_xyz||""); setTask((c.task as string)==="md" ? "opt" : c.task); setMethod(c.method as JobMethod); setCharge(c.charge); setThreads(c.threads); if(c.psi_method) setPsiMethod(c.psi_method); if(c.psi_basis) setPsiBasis(c.psi_basis); if(c.multiplicity) setMultiplicity(c.multiplicity); setCur(null); setTab("view3d"); renderXyz(c.input_xyz||""); setMsg(`已载入 ${c.id.slice(0,8)} 参数，修改后提交`) }
  const cancelCur=async()=>{ if(!cur) return; try{ await cancelJob(cur.id); setMsg(`已取消 ${cur.id.slice(0,8)}`) }catch(e:any){ setMsg(`取消失败: ${String(e?.message||e)}`) } }
  const deleteCur=async()=>{ if(!cur) return; const id=cur.id; try{ await removeJob(id); if(cur?.id===id) setCur(null); loadJobs(); setMsg(`已删除 ${id.slice(0,8)}（回收站可恢复）`) }catch(e:any){ setMsg(`删除失败: ${String(e?.message||e)}`) } }
  const deleteOne=async(id:string)=>{ try{ await removeJob(id); if(cur?.id===id) setCur(null); loadJobs() }catch(e){ console.error(e) } }
  const restoreOne=async(id:string)=>{ try{ await restoreJob(id); loadJobs() }catch(e){ console.error(e) } }
  const hardDeleteOne=async(id:string)=>{ try{ await removeJob(id,true); if(cur?.id===id) setCur(null); loadJobs() }catch(e){ console.error(e) } }
  // 侧边栏分组整理：整组移入回收站（软删，可恢复）
  const deleteMany=async(ids:string[])=>{ let n=0; await runPool(ids,8,async(id)=>{ try{ await removeJob(id); n++ }catch(e){ console.error(e) } }); if(cur && ids.includes(cur.id)) setCur(null); loadJobs(); setMsg(`已移入回收站 ${n}/${ids.length} 个`) }
  const openBatch=(id:string)=>{ setBatchFocus({id, n:Date.now()}); setTab("batch"); if(window.innerWidth<768) setSideOpen(false) }
  const openJobsTab=()=>{ setTab("jobs"); if(window.innerWidth<768) setSideOpen(false) }
  // 任务页多选批量操作
  const eachId=async(ids:string[], fn:(id:string)=>Promise<unknown>)=>{ let n=0; await runPool(ids,8,async(id)=>{ try{ await fn(id); n++ }catch(e){ console.error(e) } }); return n }
  const cancelMany=async(ids:string[])=>{ const n=await eachId(ids, cancelJob); loadJobs(); setMsg(`已取消 ${n}/${ids.length} 个`) }
  const restoreMany=async(ids:string[])=>{ const n=await eachId(ids, restoreJob); loadJobs(); setMsg(`已恢复 ${n}/${ids.length} 个`) }
  const hardDeleteMany=async(ids:string[])=>{ const n=await eachId(ids, (id)=>removeJob(id,true)); if(cur && ids.includes(cur.id)) setCur(null); loadJobs(); setMsg(`已彻底删除 ${n}/${ids.length} 个`) }
  // 按原参数重跑：拉详情取 input_xyz，参数相同的合成一个新批次（走批量调度限并发），原任务保留
  const rerunMany=async(ids:string[])=>{
    const details:Job[]=[]
    await eachId(ids, async(id)=>{ const j=await getJob(id); if(j?.input_xyz) details.push(j) })
    const order=new Map(ids.map((id,i)=>[id,i])); details.sort((a,b)=>(order.get(a.id)??0)-(order.get(b.id)??0))
    const byParams=new Map<string,Job[]>()
    for(const j of details){
      const k=JSON.stringify([j.method, (j.task as string)==="md"?"opt":j.task, j.threads, j.method==="psi4"?[j.psi_method,j.psi_basis,j.multiplicity]:null])
      byParams.set(k,[...(byParams.get(k)||[]), j])
    }
    let n=0, batches=0, err=""
    for(const js of byParams.values()){
      const j0=js[0]
      try{
        const r=await createBatch({
          items: js.map(j=>({ xyz:j.input_xyz, name:j.name||j.id.slice(0,8), charge:j.charge })),
          method:j0.method, task:(j0.task as string)==="md"?"opt":j0.task, threads:Math.min(32,Math.max(1,j0.threads||4)),
          ...(j0.method==="psi4" ? { psi_method:j0.psi_method||"b3lyp", psi_basis:j0.psi_basis||"def2-SVP", multiplicity:j0.multiplicity||1 } : {}),
        })
        n+=r.count; batches++
      }catch(e:any){ err=String(e?.message||e) }
    }
    loadJobs(); setMsg(`已重跑 ${n}/${ids.length} 个（${batches} 个新批次）${err?` · 部分失败: ${err}`:""}`)
  }
  const clearBy=async(statuses:JobStatus[])=>{ try{ const r=await clearJobs(statuses); loadJobs(); setMsg(`已清理 ${r.cleared} 个任务`) }catch(e:any){ setMsg(`清理失败: ${String(e?.message||e)}`) } }
  const handleTaskChange=(v:JobTask)=>{ setTask(v) }
  const submit=async()=>{
    try{
      const j=await createJob({
        xyz,charge,threads,task,method,
        ...(method==="psi4" ? {psi_method:psiMethod,psi_basis:psiBasis.trim()||"def2-SVP",multiplicity} : {}),
      })
      setMsg(`已提交 ${j.id.slice(0,8)}`); setTab("view3d"); loadJobs(); setTimeout(()=>show(j.id),1200)
    }catch(e:any){ setMsg(`提交失败: ${String(e?.message||e)}`) }
  }
  const useFrame=(frameXyz:string,label:string)=>{ setXyz(frameXyz); setTask("sp"); setTab("view3d"); renderXyz(frameXyz); setMsg(`已取${label}，选方法后提交QM`) }
  const show=async(id:string)=>{
    try{
      const j=await getJob(id); setCur(j); setTab("view3d")
      // 确保切回 3D tab 后 viewer 已挂载再渲染（之前用条件渲染导致 viewer 被卸载，总是显示水分子）
      setTimeout(()=>{
        const txt=j.result_xyz||(isTrajectoryTask(j.task) ? j.progress_xyz : null)||j.input_xyz||""
        if(ready) renderXyz(txt)
        else setTimeout(()=>renderXyz(txt), 600)
      }, 50)
    }catch(e){ console.error(e) }
    if(window.innerWidth<768) setSideOpen(false)
  }
  // cur 变化时也触发 3D 刷新（兜底，避免闭包 stale）
  useEffect(()=>{
    if(!cur) return
    // 等 tab 切换完成、viewer 可见后再渲染
    const t=setTimeout(()=>{
      const txt=cur.result_xyz||(isTrajectoryTask(cur.task) ? cur.progress_xyz : null)||cur.input_xyz||""
      if(ready) renderXyz(txt)
    }, 100)
    return()=>clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, ready])
  useEffect(()=>{
    const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.1.0/3Dmol-min.js"
    s.onload=()=>setTimeout(()=>initViewer(xyz, document.documentElement.classList.contains("dark")),400); document.head.appendChild(s)
    // 浏览器标签页在后台时暂停轮询，切回来立即刷新
    loadJobs(); const t=setInterval(()=>{ if(!document.hidden) loadJobs() },3000)
    const onVis=()=>{ if(!document.hidden) loadJobs() }; document.addEventListener("visibilitychange", onVis)
    return()=>{ clearInterval(t); document.removeEventListener("visibilitychange", onVis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  return <div className={`flex h-screen overflow-hidden bg-white dark:bg-black ${dark?"dark":""}`}>
    {/* 侧边栏 */}
    <aside className={`${sideOpen?"w-[300px]":"w-0"} shrink-0 border-r dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex flex-col transition-all duration-200 overflow-hidden`}>
      <div className="p-3 flex items-center justify-between border-b dark:border-zinc-800">
        <span className="font-bold text-sm">Chem Portal</span>
        <button onClick={()=>setSideOpen(false)} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded">✕</button>
      </div>
      <JobList jobs={jobs} trash={trash} curId={cur?.id ?? null} onSelect={show} onNew={()=>{setCur(null); setXyz(""); setTab("view3d"); renderXyz("")}} onDelete={deleteOne} onRestore={restoreOne} onHardDelete={hardDeleteOne} onClear={clearBy} onOpenBatch={openBatch} onDeleteMany={deleteMany} onExpand={openJobsTab} apiHint={API_BASE || "/api代理"} />
    </aside>

    {/* 主区 */}
    <div className="flex-1 flex flex-col min-w-0">
      <HeaderTabs tab={tab} onTab={setTab} sideOpen={sideOpen} onToggleSide={setSideOpen} cur={cur} dark={dark} onToggleDark={toggleDark} onClone={cloneCur} onCancel={cancelCur} onDelete={deleteCur} />

      {/* 中间内容区 */}
      <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-black p-3 md:p-6">
        <div className={`${tab==="jobs"?"max-w-7xl":"max-w-5xl"} mx-auto space-y-4`}>
          {/* 任务 tab：隐藏而非卸载，保留筛选/选择状态（点卡片看 3D 后可回来继续操作） */}
          <div className={tab==="jobs"?"":"hidden"}>
            <JobBoard active={tab==="jobs"} jobs={jobs} trash={trash} curId={cur?.id ?? null} msg={msg}
              onSelect={show} onOpenBatch={openBatch}
              onCancelMany={cancelMany} onDeleteMany={deleteMany} onRestoreMany={restoreMany}
              onHardDeleteMany={hardDeleteMany} onRerunMany={rerunMany} />
          </div>

          {/* 批量 tab：隐藏而非卸载，保留已拖入的文件列表 */}
          <div className={tab==="batch"?"":"hidden"}>
            <BatchPanel active={tab==="batch"} task={task} method={method}
              psiMethod={psiMethod} psiBasis={psiBasis} multiplicity={multiplicity}
              onTaskChange={handleTaskChange} onMethodChange={setMethod}
              onPsiMethodChange={setPsiMethod} onPsiBasisChange={setPsiBasis} onMultiplicityChange={setMultiplicity}
              onSelect={show} onSubmitted={loadJobs} focusBatch={batchFocus} />
          </div>

          {tab!=="batch" && tab!=="jobs" && <SubmitForm xyz={xyz} task={task} method={method} charge={charge} threads={threads}
            psiMethod={psiMethod} psiBasis={psiBasis} multiplicity={multiplicity} msg={msg}
            onXyzChange={v=>{setXyz(v); renderXyz(v)}} onTaskChange={handleTaskChange} onMethodChange={setMethod}
            onChargeChange={setCharge} onThreadsChange={setThreads} onPsiMethodChange={setPsiMethod}
            onPsiBasisChange={setPsiBasis} onMultiplicityChange={setMultiplicity} onSubmit={submit} />}

          {/* 优化过程展示区 - 根据 tab 切换（批量 tab 下隐藏，viewer 不卸载） */}
          <div className={`bg-white dark:bg-zinc-900 rounded-xl border dark:border-zinc-800 shadow-sm overflow-hidden ${tab==="batch"||tab==="jobs"?"hidden":""}`}>
            <div className={tab==="view3d"?"":"hidden"}>
              <Viewer3D cur={cur} frames={frames} frame={frame} viewerErr={viewerErr} debug={debug} viewerElRef={viewerElRef}
                onPlay={play} onPause={pause} onReset={reset} onFrameChange={goToFrame} />
            </div>
            {tab==="xyz" && <XyzPanel cur={cur} fallbackXyz={xyz} onUseFrame={useFrame} />}
            {tab==="log" && <LogPanel cur={cur} />}
          </div>
        </div>
      </div>
    </div>

    {/* 手机遮罩 */}
    {sideOpen && <div onClick={()=>setSideOpen(false)} className="md:hidden fixed inset-0 bg-black/30 z-10" />}
  </div>
}
