import React, { useRef, useState, useCallback, useEffect } from 'react'
import Head from 'next/head'
import Script from 'next/script'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
type RecordingStatus = 'idle' | 'recording'

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<ReturnType<typeof window.DuckSoup.render> extends Promise<infer T> ? T : never>(null)

  // Dual recording: altered (DuckSoup mirror) + clean (local webcam)
  const alteredRecorderRef = useRef<MediaRecorder | null>(null)
  const cleanRecorderRef = useRef<MediaRecorder | null>(null)
  const alteredChunksRef = useRef<Blob[]>([])
  const cleanChunksRef = useRef<Blob[]>([])

  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle')
  const [recordingFolder, setRecordingFolder] = useState<string | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [dsReady, setDsReady] = useState(false)
  const [interactionName, setInteractionName] = useState(() => `mirror-${Date.now()}`)
  const [signalingUrl, setSignalingUrl] = useState('ws://localhost:8100/ws')

  // Mozza Parameters
  const [smile, setSmile] = useState(1.0)
  const [faceThresh, setFaceThresh] = useState(0.25)
  const [overlay, setOverlay] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString()
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 50))
  }, [])

  // Update Mozza parameters in real-time
  const handleUpdateMozza = useCallback((prop: string, val: number | boolean) => {
    if (playerRef.current) {
      // Map boolean to 1/0 for GStreamer
      const value = typeof val === 'boolean' ? (val ? 1 : 0) : val
      playerRef.current.controlFx('mozza', prop, value as number)
      addLog(`Updated mozza ${prop}: ${val}`)
    }
  }, [addLog])

  // Helper: save a blob to disk via IPC
  const saveBlob = useCallback(async (blob: Blob, filename: string, folder: string) => {
    const buffer = await blob.arrayBuffer()
    try {
      const savedPath = await window.ipc.invoke<string>('save-recording', {
        folder,
        filename,
        buffer,
      })
      addLog(`Saved: ${savedPath}`)
    } catch (err) {
      addLog(`Failed to save ${filename}: ${err}`)
    }
  }, [addLog])

  // Connect to DuckSoup
  const handleConnect = useCallback(async () => {
    if (!window.DuckSoup) {
      addLog('ERROR: DuckSoup.js not loaded')
      return
    }

    setStatus('connecting')
    addLog(`Connecting to ${signalingUrl}...`)

    // Generate a fresh interaction name for each connection
    const freshName = `mirror-${Date.now()}`
    setInteractionName(freshName)

    try {
      // 1. Grab local webcam FIRST (before DuckSoup claims it)
      //    This stream is used for the "clean" recording (no FX)
      let localStream: MediaStream | null = null
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true,
        })
        addLog(`Local webcam acquired: ${localStream.getTracks().length} tracks`)
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream
          localVideoRef.current.play().catch(() => {})
        }
      } catch (camErr) {
        addLog(`WARNING: Could not access local webcam: ${camErr}`)
      }

      // 2. Connect to DuckSoup (it will call getUserMedia internally for its own stream)
      const player = await window.DuckSoup.render(
        {
          callback: ({ kind, payload }) => {
            switch (kind) {
              case 'joined':
                addLog(`Joined interaction (${payload})`)
                break
              case 'track': {
                const trackEvent = payload as RTCTrackEvent
                addLog(`Track received: ${trackEvent.track.kind}`)
                if (trackEvent.track.kind === 'video' && videoRef.current) {
                  if (!videoRef.current.srcObject) {
                    videoRef.current.srcObject = new MediaStream()
                  }
                  ;(videoRef.current.srcObject as MediaStream).addTrack(trackEvent.track)
                  videoRef.current.play().catch(() => {})
                }
                if (trackEvent.track.kind === 'audio' && videoRef.current) {
                  if (!videoRef.current.srcObject) {
                    videoRef.current.srcObject = new MediaStream()
                  }
                  ;(videoRef.current.srcObject as MediaStream).addTrack(trackEvent.track)
                }
                break
              }
              case 'start':
                addLog(`Interaction started (${payload}s remaining)`)
                setStatus('connected')
                break
              case 'ending':
                addLog('Interaction ending soon...')
                break
              case 'end':
                addLog('Interaction ended')
                setStatus('disconnected')
                break
              case 'closed':
                addLog('Connection closed')
                setStatus('disconnected')
                break
              case 'error':
              case 'error-join':
              case 'error-duplicate':
              case 'error-full':
              case 'error-aborted':
                addLog(`Error: ${kind} ${payload || ''}`)
                setStatus('error')
                break
              default:
                break
            }
          },
          stats: false,
        },
        {
          signalingUrl,
          interactionName: freshName,
          userId: `user-${Math.random().toString(36).substring(7)}`,
          duration: 3600,
          size: 1,
          width: 640,
          height: 480,
          framerate: 25,
          videoFormat: 'H264',
          // Inject mozza with initial parameters
          videoFx: `mozza alpha=${smile} face-thresh=${faceThresh} overlay=${overlay ? 'true' : 'false'}`,
          recordingMode: 'forced',
          namespace: 'electron_mirror',
          gpu: false,
        }
      )

      playerRef.current = player
    } catch (err) {
      addLog(`Connection failed: ${err}`)
      setStatus('error')
    }
  }, [signalingUrl, addLog, smile, faceThresh, overlay])

  // Disconnect from DuckSoup
  const handleDisconnect = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.stop()
      playerRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    if (localVideoRef.current) {
      const stream = localVideoRef.current.srcObject as MediaStream
      stream?.getTracks().forEach((t) => t.stop())
      localVideoRef.current.srcObject = null
    }
    setStatus('disconnected')
    addLog('Disconnected')
  }, [addLog])

  // Select recording folder
  const handleSelectFolder = useCallback(async () => {
    const folder = await window.ipc.invoke<string | null>('select-folder')
    if (folder) {
      setRecordingFolder(folder)
      addLog(`Recording folder: ${folder}`)
    }
  }, [addLog])

  // Start recording BOTH streams
  const handleStartRecording = useCallback(() => {
    const alteredStream = videoRef.current?.srcObject as MediaStream | null
    const cleanStream = localVideoRef.current?.srcObject as MediaStream | null

    if (!alteredStream) {
      addLog('No altered stream — connect to DuckSoup first')
      return
    }
    if (!cleanStream) {
      addLog('No clean stream — webcam not available')
      return
    }
    if (!recordingFolder) {
      addLog('Please select a recording folder first')
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    addLog(`Altered stream: ${alteredStream.getTracks().length} tracks`)
    addLog(`Clean stream: ${cleanStream.getTracks().length} tracks`)

    // --- Altered stream recorder (from DuckSoup) ---
    alteredChunksRef.current = []
    const alteredRecorder = new MediaRecorder(alteredStream, {
      mimeType: 'video/webm;codecs=vp9',
    })
    alteredRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) alteredChunksRef.current.push(e.data)
    }
    alteredRecorder.onstop = async () => {
      const blob = new Blob(alteredChunksRef.current, { type: 'video/webm' })
      addLog(`Altered recording: ${(blob.size / 1024).toFixed(0)} KB`)
      await saveBlob(blob, `${timestamp}-altered.webm`, recordingFolder)
    }

    // --- Clean stream recorder (raw webcam, no FX) ---
    cleanChunksRef.current = []
    const cleanRecorder = new MediaRecorder(cleanStream, {
      mimeType: 'video/webm;codecs=vp9',
    })
    cleanRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) cleanChunksRef.current.push(e.data)
    }
    cleanRecorder.onstop = async () => {
      const blob = new Blob(cleanChunksRef.current, { type: 'video/webm' })
      addLog(`Clean recording: ${(blob.size / 1024).toFixed(0)} KB`)
      await saveBlob(blob, `${timestamp}-clean.webm`, recordingFolder)
    }

    // Start both
    alteredRecorder.start(1000)
    cleanRecorder.start(1000)
    alteredRecorderRef.current = alteredRecorder
    cleanRecorderRef.current = cleanRecorder

    setRecordingStatus('recording')
    setRecordingTime(0)
    addLog('Recording started (altered + clean)')

    timerRef.current = setInterval(() => {
      setRecordingTime((prev) => prev + 1)
    }, 1000)
  }, [recordingFolder, addLog, saveBlob])

  // Stop recording BOTH streams
  const handleStopRecording = useCallback(() => {
    if (alteredRecorderRef.current && alteredRecorderRef.current.state !== 'inactive') {
      alteredRecorderRef.current.stop()
      alteredRecorderRef.current = null
    }
    if (cleanRecorderRef.current && cleanRecorderRef.current.state !== 'inactive') {
      cleanRecorderRef.current.stop()
      cleanRecorderRef.current = null
    }
    setRecordingStatus('idle')
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    addLog('Recording stopped — saving files...')
  }, [addLog])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      handleDisconnect()
    }
  }, [handleDisconnect])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const statusColors: Record<ConnectionStatus, string> = {
    disconnected: 'bg-gray-500',
    connecting: 'bg-yellow-500',
    connected: 'bg-green-500',
    error: 'bg-red-500',
  }

  return (
    <>
      <Head>
        <title>DuckSoup Mirror — Mozza Research</title>
      </Head>
      <Script
        src="/ducksoup.js"
        strategy="afterInteractive"
        onLoad={() => {
          setDsReady(true)
        }}
      />

      <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-emerald-400">🦆 DuckSoup + Mozza</h1>
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${statusColors[status]}`}
              title={status}
            />
            <span className="text-sm text-gray-400 capitalize">{status}</span>
          </div>
          <div className="flex items-center gap-2">
            {status === 'disconnected' || status === 'error' ? (
              <button
                onClick={handleConnect}
                disabled={!dsReady}
                className="px-4 py-1.5 text-sm font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Connect
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="px-4 py-1.5 text-sm font-medium rounded-md bg-red-600 hover:bg-red-500 transition-colors"
              >
                Disconnect
              </button>
            )}
          </div>
        </header>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Video panels */}
          <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
            {/* DuckSoup mirror video (Altered) */}
            <div className="flex-1 relative bg-gray-900 rounded-xl overflow-hidden border border-gray-800 shadow-2xl shadow-emerald-900/10">
              <div className="absolute top-3 left-3 z-10 px-2 py-1 rounded bg-black/60 text-[10px] uppercase tracking-wider font-bold text-emerald-400">
                Altered Reflection (DuckSoup)
              </div>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
              {status !== 'connected' && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
                  <div className="text-center">
                    <p className="text-gray-500 text-lg mb-2">
                      {status === 'connecting' ? 'Establishing WebRTC Connection...' : 'Disconnected'}
                    </p>
                    {status === 'disconnected' && <p className="text-gray-600 text-sm">Click Connect to start the session</p>}
                  </div>
                </div>
              )}
            </div>

            {/* Local webcam preview (Clean) */}
            <div className="h-48 relative bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
              <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded bg-black/60 text-[10px] uppercase tracking-wider font-bold text-gray-400">
                Clean Reflection (Local)
              </div>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />
            </div>
          </div>

          {/* Right sidebar */}
          <div className="w-80 flex flex-col bg-gray-900 border-l border-gray-800 overflow-hidden">
            
            {/* Mozza Parameter Controls */}
            <div className="p-4 border-b border-gray-800 bg-gray-800/20">
              <h2 className="text-sm font-semibold mb-4 text-emerald-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Mozza Parameters
              </h2>
              
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Smile Alpha</label>
                    <span className="text-xs font-mono text-emerald-400">{smile.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="-2"
                    max="5"
                    step="0.1"
                    value={smile}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setSmile(val)
                      handleUpdateMozza('alpha', val)
                    }}
                    className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                    <span>Frown</span>
                    <span>Neutral</span>
                    <span>Smile</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Detection Threshold</label>
                    <span className="text-xs font-mono text-emerald-400">{faceThresh.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={faceThresh}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setFaceThresh(val)
                      handleUpdateMozza('face-thresh', val)
                    }}
                    className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg border border-gray-700">
                  <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Debug Overlay</label>
                  <input
                    type="checkbox"
                    checked={overlay}
                    onChange={(e) => {
                      const val = e.target.checked
                      setOverlay(val)
                      handleUpdateMozza('overlay', val)
                    }}
                    className="w-4 h-4 rounded border-gray-700 text-emerald-500 focus:ring-emerald-500 bg-gray-900"
                  />
                </div>
              </div>
            </div>

            {/* Recording controls */}
            <div className="p-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold mb-3 text-gray-300">Session Recording</h2>
              <button
                onClick={handleSelectFolder}
                className="w-full mb-3 px-3 py-2 text-xs rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors flex items-center justify-center gap-2"
              >
                {recordingFolder ? `📁 ${recordingFolder.split('/').pop()}` : '📁 Select Save Folder'}
              </button>

              {recordingStatus === 'idle' ? (
                <button
                  onClick={handleStartRecording}
                  disabled={!recordingFolder || status !== 'connected'}
                  className="w-full px-3 py-2.5 text-sm font-bold rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 shadow-lg shadow-red-900/20"
                >
                  ⏺ Start Dual Recording
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleStopRecording}
                    className="flex-1 px-3 py-2.5 text-sm font-bold rounded-md bg-gray-700 hover:bg-gray-600 transition-all"
                  >
                    ⏹ Stop Recording
                  </button>
                  <div className="flex flex-col items-center px-2">
                    <span className="text-red-500 text-xs font-bold animate-pulse">REC</span>
                    <span className="text-white text-xs font-mono">{formatTime(recordingTime)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Logs */}
            <div className="flex-1 flex flex-col overflow-hidden p-4">
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-sm font-semibold text-gray-300">Event Log</h2>
                <button onClick={() => setLogs([])} className="text-[10px] text-gray-500 hover:text-gray-300">Clear</button>
              </div>
              <div className="flex-1 overflow-y-auto text-[10px] font-mono text-gray-400 space-y-1 scrollbar-hide">
                {logs.map((log, i) => (
                  <div key={i} className={`leading-tight p-1 rounded ${log.includes('Saved') ? 'bg-emerald-900/20 text-emerald-300' : ''}`}>
                    {log}
                  </div>
                ))}
                {logs.length === 0 && (
                  <p className="text-gray-600 italic">Awaiting connection...</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

