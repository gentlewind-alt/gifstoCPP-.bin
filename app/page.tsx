'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, CheckCircle2, Loader2, Clock, Play, Pause, 
  SkipBack, SkipForward, Settings, HelpCircle, ChevronDown, Copy, Info
} from 'lucide-react';
import { 
  ProcessSettings, ProcessedFile, processFile, exportZIP, buildCombinedBinary, DitherType, CompressionType 
} from '@/lib/processor';

const DEFAULT_SETTINGS: ProcessSettings = {
  width: 128,
  height: 64,
  ditherType: 'atkinson',
  threshold: 128,
  invert: false,
  compression: 'rle',
  targetFps: 15
};

export default function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [globalSettings, setGlobalSettings] = useState<ProcessSettings>(DEFAULT_SETTINGS);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'global' | 'selected'>('global');
  
  const [previewZoom, setPreviewZoom] = useState<number>(2);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const currentFrameIndexRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  
  const [outputTab, setOutputTab] = useState<'carray' | 'summary'>('carray');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  const selectedFile = files.find(f => f.id === selectedFileId);

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    
    const newFiles: ProcessedFile[] = Array.from(e.target.files).map(file => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      file,
      status: 'pending',
      frames: [],
      binary: new Uint8Array(),
      cArray: '',
      previewUrl: '',
      originalPreviewUrl: '',
      settings: { ...globalSettings },
      useGlobalSettings: true
    }));

    setFiles(prev => [...prev, ...newFiles]);
    if (!selectedFileId && newFiles.length > 0) {
      setSelectedFileId(newFiles[0].id);
    }
    
    // Process files
    processFiles(newFiles);
  };

  const processFiles = async (filesToProcess: ProcessedFile[]) => {
    setIsProcessing(true);
    
    const ids = filesToProcess.map(f => f.id);
    setFiles(prev => prev.map(file => ids.includes(file.id) ? { ...file, status: 'processing' } : file));
    
    await Promise.all(filesToProcess.map(async (f) => {
      const result = await processFile(f.file, f.useGlobalSettings ? globalSettings : f.settings);
      setFiles(prev => prev.map(file => file.id === f.id ? { ...file, ...result } : file));
    }));
    
    setIsProcessing(false);
  };

  // Animation loop
  useEffect(() => {
    currentFrameIndexRef.current = currentFrameIndex;
  }, [currentFrameIndex]);

  useEffect(() => {
    const animate = (time: number) => {
      if (!selectedFile || selectedFile.frames.length <= 1) return;
      
      const frame = selectedFile.frames[currentFrameIndexRef.current];
      const delay = frame?.delay || 100;

      if (time - lastFrameTimeRef.current >= delay) {
        setCurrentFrameIndex(prev => {
          const next = (prev + 1) % selectedFile.frames.length;
          currentFrameIndexRef.current = next;
          return next;
        });
        lastFrameTimeRef.current = time;
      }
      
      if (isPlaying) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    if (isPlaying) {
      animationRef.current = requestAnimationFrame(animate);
    } else if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, selectedFile]);

  const handleFileSelect = (id: string) => {
    setSelectedFileId(id);
    setCurrentFrameIndex(0);
    setIsPlaying(false);
  };

  const handleExportAll = async () => {
    const zipBlob = await exportZIP(files);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'esp32_animations.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadBin = () => {
    if (!selectedFile || selectedFile.status !== 'done') return;
    const blob = new Blob([selectedFile.binary as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFile.name.replace(/\.[^/.]+$/, "") + '.bin';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCombinedBin = () => {
    if (files.length === 0) return;
    const combined = buildCombinedBinary(files);
    const blob = new Blob([combined.data as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'combined_animations.bin';
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalSize = files.reduce((acc, f) => acc + (f.binary?.length || 0), 0);
  const flashLimit = 512 * 1024; // 512 KB

  const activeSettings = settingsTab === 'global' ? globalSettings : (selectedFile?.settings || globalSettings);

  const updateSettings = (updates: Partial<ProcessSettings>) => {
    if (settingsTab === 'global') {
      setGlobalSettings(prev => ({ ...prev, ...updates }));
    } else if (selectedFile) {
      setFiles(prev => prev.map(f => f.id === selectedFile.id ? { ...f, settings: { ...f.settings, ...updates }, useGlobalSettings: false } : f));
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#10141a] text-[#dfe2eb] font-mono selection:bg-[#00f5ff]/30">
      {/* Header */}
      <header className="bg-[#10141a] border-b-2 border-[#1c2026] shadow-[0_0_15px_0px_rgba(0,245,255,0.15)] flex justify-between items-center w-full px-6 h-16 shrink-0 z-50">
        <div className="flex items-center gap-8">
          <h1 className="text-xl font-bold tracking-tighter text-[#00f5ff] font-sans">ESP32 Animation Converter</h1>
          <nav className="hidden md:flex gap-6 font-sans text-sm font-medium">
            <a className="text-[#00f5ff] border-b-2 border-[#00f5ff] pb-1" href="#">Files</a>
            <a className="text-[#31353c] hover:text-[#00f5ff] transition-colors" href="#">Optimization</a>
            <a className="text-[#31353c] hover:text-[#00f5ff] transition-colors" href="#">Presets</a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium text-[#b9caca]">{files.length} files loaded</span>
          <button 
            onClick={handleExportAll}
            disabled={files.length === 0 || isProcessing}
            className="bg-[#00f5ff] text-[#003739] px-4 py-1.5 rounded-sm text-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-[0_0_15px_0px_rgba(0,245,255,0.15)] disabled:opacity-50"
          >
            Export All
          </button>
          <div className="flex gap-2 ml-4">
            <Settings className="w-5 h-5 text-[#b9caca] hover:text-[#00f5ff] cursor-pointer transition-colors" />
            <HelpCircle className="w-5 h-5 text-[#b9caca] hover:text-[#00f5ff] cursor-pointer transition-colors" />
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside className="bg-[#1c2026] border-r border-[#3a494a]/20 flex flex-col h-full w-80 shrink-0">
          <div className="p-4 border-b border-[#3a494a]/10">
            <label className="bg-[#0a0e14] border-2 border-dashed border-[#3a494a]/30 rounded-md p-6 text-center hover:border-[#00f5ff]/50 transition-colors group cursor-pointer block">
              <Upload className="w-6 h-6 mx-auto text-[#849495] group-hover:text-[#00f5ff] transition-colors" />
              <p className="text-[10px] uppercase font-sans mt-2 text-[#b9caca] tracking-wider">Drag & Drop GIFs/PNGs</p>
              <input 
                type="file" 
                multiple 
                accept="image/png, image/jpeg, image/gif" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
            </label>
          </div>
          
          <div className="flex-1 overflow-y-auto py-2 scrollbar-hide">
            <div className="px-4 py-2 flex items-center justify-between">
              <h3 className="font-sans text-[10px] uppercase tracking-widest text-[#b9caca] font-bold">Active Batch</h3>
              <span className="text-[10px] text-[#00f5ff]">{files.length} Selected</span>
            </div>
            
            <div className="space-y-1">
              {files.map(file => (
                <div 
                  key={file.id}
                  onClick={() => handleFileSelect(file.id)}
                  className={`${selectedFileId === file.id ? 'bg-[#10141a] text-[#00f5ff] border-l-4 border-[#00f5ff]' : 'text-[#31353c] hover:bg-[#10141a]/50 border-l-4 border-transparent'} px-4 py-3 flex items-center gap-3 group cursor-pointer transition-all`}
                >
                  <div className="w-10 h-10 bg-[#262a31] rounded-sm overflow-hidden shrink-0 border border-[#3a494a]/20">
                    {file.originalPreviewUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={file.originalPreviewUrl} alt={file.name} className={`w-full h-full object-cover ${file.status !== 'done' ? 'opacity-50' : ''}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold truncate ${selectedFileId === file.id ? '' : 'text-[#dfe2eb]'}`}>{file.name}</p>
                    <div className="flex gap-2 text-[9px] text-[#b9caca] mt-0.5">
                      <span>{file.settings.width}x{file.settings.height}</span>
                      <span>•</span>
                      <span>{file.frames.length || 1} Frames</span>
                    </div>
                  </div>
                  {file.status === 'done' && <CheckCircle2 className="w-4 h-4 text-[#3bff17]" />}
                  {file.status === 'processing' && <Loader2 className="w-4 h-4 text-[#7805c3] animate-spin" />}
                  {file.status === 'pending' && <Clock className="w-4 h-4 text-[#849495]" />}
                </div>
              ))}
            </div>
          </div>
          
          <div className="p-4 border-t border-[#3a494a]/10 grid grid-cols-2 gap-2">
            <button 
              onClick={() => {
                setFiles([]);
                setSelectedFileId(null);
              }}
              className="bg-[#31353c] text-[#dfe2eb] text-[10px] font-sans uppercase py-2 hover:bg-[#3a494a] transition-colors"
            >
              Clear All
            </button>
            <button 
              onClick={() => {
                if (selectedFileId) {
                  const newFiles = files.filter(f => f.id !== selectedFileId);
                  setFiles(newFiles);
                  if (newFiles.length > 0) {
                    setSelectedFileId(newFiles[0].id);
                  } else {
                    setSelectedFileId(null);
                  }
                }
              }}
              disabled={!selectedFileId}
              className="bg-[#31353c] text-[#ffb4ab] text-[10px] font-sans uppercase py-2 hover:bg-[#93000a]/20 transition-colors disabled:opacity-50"
            >
              Remove Selected
            </button>
          </div>
        </aside>

        {/* Center Workspace */}
        <section className="flex-1 flex flex-col bg-[#10141a] overflow-hidden">
          {/* Preview Header */}
          <div className="h-12 border-b border-[#3a494a]/10 flex items-center justify-between px-6 bg-[#181c22]/50 shrink-0">
            <div className="flex items-center gap-4">
              <span className="font-sans text-xs uppercase tracking-tighter text-[#b9caca]">Preview Mode: Split View</span>
              <div className="flex items-center gap-1 bg-[#0a0e14] p-0.5 rounded-sm">
                {[2, 4, 8].map(zoom => (
                  <button 
                    key={zoom}
                    onClick={() => setPreviewZoom(zoom)}
                    className={`px-2 py-0.5 text-[10px] ${previewZoom === zoom ? 'bg-[#00f5ff] text-[#002021] font-bold' : 'text-[#b9caca] hover:text-[#e9feff]'}`}
                  >
                    {zoom}X
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-6 h-3 rounded-full relative transition-colors ${showGrid ? 'bg-[#00f5ff]' : 'bg-[#31353c]'}`}>
                  <div className={`absolute top-0.5 w-2 h-2 bg-[#002021] rounded-full transition-all ${showGrid ? 'left-3.5' : 'left-0.5 bg-[#00f5ff]'}`}></div>
                </div>
                <span className="text-[10px] uppercase font-sans text-[#b9caca] group-hover:text-[#e9feff]">Pixel Grid</span>
                <input type="checkbox" className="hidden" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              </label>
            </div>
          </div>

          {/* Preview Split View */}
          <div className="flex-1 relative flex items-center justify-center p-8 overflow-hidden bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]">
            {selectedFile ? (
              <div className="flex gap-8 items-center">
                {/* Original */}
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-sans text-[#b9caca] uppercase text-center">Original</span>
                  <div 
                    className="bg-[#0a0e14] border border-[#3a494a]/30 flex items-center justify-center relative overflow-hidden group"
                    style={{ width: selectedFile.settings.width * previewZoom, height: selectedFile.settings.height * previewZoom }}
                  >
                    {selectedFile.frames[currentFrameIndex]?.originalPreviewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={selectedFile.frames[currentFrameIndex].originalPreviewUrl} alt="Original" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                    ) : selectedFile.originalPreviewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={selectedFile.originalPreviewUrl} alt="Original" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                    ) : null}
                    <div className="absolute inset-0 border-2 border-transparent group-hover:border-[#00f5ff]/20 transition-all"></div>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-48 w-px bg-[#3a494a]/20 relative">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 bg-[#262a31] border border-[#3a494a]/50 flex items-center justify-center text-[10px] font-bold">VS</div>
                </div>

                {/* Processed (Dithered) */}
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-sans text-[#00f5ff] uppercase text-center">Dithered ({selectedFile.settings.ditherType})</span>
                  <div 
                    className="bg-black border border-[#00f5ff]/30 flex items-center justify-center relative overflow-hidden group shadow-[0_0_15px_0px_rgba(0,245,255,0.15)]"
                    style={{ width: selectedFile.settings.width * previewZoom, height: selectedFile.settings.height * previewZoom }}
                  >
                    {selectedFile.frames[currentFrameIndex]?.previewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img 
                        src={selectedFile.frames[currentFrameIndex].previewUrl} 
                        alt="Dithered" 
                        className="w-full h-full object-contain" 
                        style={{ 
                          imageRendering: 'pixelated',
                          filter: selectedFile.settings.invert ? 'invert(1)' : 'none'
                        }} 
                      />
                    ) : selectedFile.previewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img 
                        src={selectedFile.previewUrl} 
                        alt="Dithered" 
                        className="w-full h-full object-contain" 
                        style={{ 
                          imageRendering: 'pixelated',
                          filter: selectedFile.settings.invert ? 'invert(1)' : 'none'
                        }} 
                      />
                    ) : null}
                    {showGrid && (
                      <div 
                        className="absolute inset-0 pointer-events-none" 
                        style={{ 
                          backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)`,
                          backgroundSize: `${previewZoom}px ${previewZoom}px`
                        }}
                      ></div>
                    )}
                    <div className="absolute inset-0 bg-[#00f5ff]/5 pointer-events-none"></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[#849495] text-sm">Select a file to preview</div>
            )}
          </div>

          {/* Scrubber */}
          <div className="h-16 bg-[#181c22] border-t border-[#3a494a]/10 px-6 flex items-center gap-6 shrink-0">
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={!selectedFile || selectedFile.frames.length <= 1}
              className="w-8 h-8 flex items-center justify-center text-[#00f5ff] hover:bg-[#00f5ff]/10 transition-all disabled:opacity-50"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <div className="flex-1 flex flex-col gap-1">
              <div className="flex justify-between text-[10px] text-[#b9caca]">
                <span>Frame {currentFrameIndex + 1} / {selectedFile?.frames.length || 0}</span>
                <span>
                  {((selectedFile?.frames.slice(0, currentFrameIndex).reduce((a, b) => a + b.delay, 0) || 0) / 1000).toFixed(1)}s / 
                  {((selectedFile?.frames.reduce((a, b) => a + b.delay, 0) || 0) / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="h-1.5 w-full bg-[#0a0e14] rounded-full overflow-hidden relative">
                <div 
                  className="absolute inset-y-0 left-0 bg-[#00f5ff] shadow-[0_0_15px_0px_rgba(0,245,255,0.15)] transition-all duration-100"
                  style={{ width: `${selectedFile && selectedFile.frames.length > 0 ? ((currentFrameIndex + 1) / selectedFile.frames.length) * 100 : 0}%` }}
                ></div>
              </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setCurrentFrameIndex(prev => Math.max(0, prev - 1))}
                disabled={!selectedFile || selectedFile.frames.length <= 1}
                className="text-[#b9caca] hover:text-[#e9feff] disabled:opacity-50"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setCurrentFrameIndex(prev => Math.min((selectedFile?.frames.length || 1) - 1, prev + 1))}
                disabled={!selectedFile || selectedFile.frames.length <= 1}
                className="text-[#b9caca] hover:text-[#e9feff] disabled:opacity-50"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Output Tabs & Code */}
          <div className="h-64 bg-[#0a0e14] border-t border-[#3a494a]/20 flex flex-col shrink-0">
            <div className="flex border-b border-[#3a494a]/20 px-4">
              <button 
                onClick={() => setOutputTab('carray')}
                className={`px-6 py-2 text-[10px] font-sans uppercase font-bold ${outputTab === 'carray' ? 'text-[#00f5ff] border-b-2 border-[#00f5ff]' : 'text-[#b9caca] hover:text-[#dfe2eb]'}`}
              >
                Selected File C-Array
              </button>
              <button 
                onClick={() => setOutputTab('summary')}
                className={`px-6 py-2 text-[10px] font-sans uppercase font-bold ${outputTab === 'summary' ? 'text-[#00f5ff] border-b-2 border-[#00f5ff]' : 'text-[#b9caca] hover:text-[#dfe2eb]'}`}
              >
                Batch Summary
              </button>
            </div>
            <div className="flex-1 p-4 text-[11px] overflow-auto relative scrollbar-hide">
              <div className="absolute top-2 right-4 text-[#3bff17] flex items-center gap-1.5 bg-[#3bff17]/5 px-2 py-1 border border-[#3bff17]/20">
                <Info className="w-3 h-3" />
                <span>Optimization Tip: Reduce FPS to save 40% space.</span>
              </div>
              <pre className="text-[#dfe2eb]/80 leading-relaxed">
                {outputTab === 'carray' 
                  ? (selectedFile?.cArray || '// Select a file to view C-Array')
                  : `// Batch Summary\nTotal Files: ${files.length}\nTotal Size: ${(totalSize / 1024).toFixed(1)} KB\n\nFiles:\n${files.map(f => `- ${f.name}: ${(f.binary.length / 1024).toFixed(1)} KB (${f.status})`).join('\n')}`
                }
              </pre>
            </div>
            <div className="h-12 border-t border-[#3a494a]/10 px-4 flex items-center justify-between bg-[#181c22]">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => {
                    if (selectedFile?.cArray) {
                      navigator.clipboard.writeText(selectedFile.cArray);
                    }
                  }}
                  className="flex items-center gap-2 text-[10px] font-sans uppercase text-[#dfe2eb] hover:text-[#e9feff] transition-colors"
                >
                  <Copy className="w-4 h-4" /> Copy C Arrays
                </button>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={handleDownloadBin}
                  disabled={!selectedFile || selectedFile.status !== 'done'}
                  className="bg-[#31353c] px-3 py-1.5 text-[10px] font-sans uppercase border border-[#3a494a]/30 hover:border-[#00f5ff]/50 transition-all disabled:opacity-50"
                >
                  Download .bin
                </button>
                <button 
                  onClick={handleDownloadCombinedBin}
                  disabled={files.length === 0}
                  className="bg-[#31353c] px-3 py-1.5 text-[10px] font-sans uppercase border border-[#3a494a]/30 hover:border-[#00f5ff]/50 transition-all disabled:opacity-50"
                >
                  Combined .bin
                </button>
                <button 
                  onClick={handleExportAll}
                  disabled={files.length === 0}
                  className="bg-[#7805c3] px-3 py-1.5 text-[10px] font-sans uppercase text-[#ddb1ff] border border-transparent hover:opacity-90 transition-all disabled:opacity-50"
                >
                  Download All .ZIP
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Right Control Panel */}
        <aside className="w-80 bg-[#1c2026] border-l border-[#3a494a]/20 shrink-0 flex flex-col h-full">
          <div className="p-4 border-b border-[#3a494a]/10">
            <div className="flex p-1 bg-[#0a0e14] rounded-sm border border-[#3a494a]/10">
              <button 
                onClick={() => setSettingsTab('selected')}
                className={`flex-1 py-1.5 text-[10px] font-sans uppercase ${settingsTab === 'selected' ? 'bg-[#262a31] text-[#00f5ff] font-bold shadow-sm' : 'text-[#b9caca] hover:text-[#dfe2eb]'}`}
              >
                Selected Only
              </button>
              <button 
                onClick={() => setSettingsTab('global')}
                className={`flex-1 py-1.5 text-[10px] font-sans uppercase ${settingsTab === 'global' ? 'bg-[#262a31] text-[#00f5ff] font-bold shadow-sm' : 'text-[#b9caca] hover:text-[#dfe2eb]'}`}
              >
                Global Settings
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
            {/* Processor Settings */}
            <div className="space-y-4">
              <h4 className="font-sans text-[10px] uppercase tracking-widest text-[#b9caca] font-bold border-l-2 border-[#7805c3] pl-3">Image Processor</h4>
              
              <div className="space-y-1.5">
                <label className="text-[10px] text-[#b9caca]">Dithering Algorithm</label>
                <div className="relative group">
                  <select 
                    value={activeSettings.ditherType}
                    onChange={(e) => updateSettings({ ditherType: e.target.value as DitherType })}
                    className="w-full bg-[#0a0e14] border border-[#3a494a]/30 text-[#dfe2eb] text-xs py-2 px-3 appearance-none focus:ring-1 focus:ring-[#00f5ff] outline-none"
                  >
                    <option value="atkinson">Atkinson (Sharpest)</option>
                    <option value="floyd-steinberg">Floyd-Steinberg</option>
                    <option value="bayer">Ordered Dither (Retro)</option>
                    <option value="threshold">Threshold (No Dither)</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-[#b9caca] pointer-events-none w-4 h-4" />
                </div>
              </div>
              
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-[#b9caca]">
                  <label>Luma Threshold</label>
                  <span className="text-[#00f5ff]">{activeSettings.threshold}</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="255" 
                  value={activeSettings.threshold}
                  onChange={(e) => updateSettings({ threshold: parseInt(e.target.value) })}
                  className="w-full h-1 bg-[#0a0e14] rounded-full appearance-none accent-[#00f5ff] cursor-pointer" 
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-[#b9caca]">Palette</label>
                  <button 
                    onClick={() => updateSettings({ invert: !activeSettings.invert })}
                    className="w-full bg-[#0a0e14] border border-[#3a494a]/30 text-[11px] py-1.5 px-3 flex items-center justify-center gap-2"
                  >
                    <div className="flex -space-x-1">
                      <div className={`w-3 h-3 ${activeSettings.invert ? 'bg-black' : 'bg-white'} border border-[#3a494a]/20 rounded-full`}></div>
                      <div className={`w-3 h-3 ${activeSettings.invert ? 'bg-white' : 'bg-black'} border border-[#3a494a]/20 rounded-full`}></div>
                    </div>
                    <span>{activeSettings.invert ? 'W/B' : 'B/W'}</span>
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-[#b9caca]">Resolution</label>
                  <div className="bg-[#0a0e14] border border-[#3a494a]/30 text-[11px] py-1.5 px-3 text-center">
                    {activeSettings.width}x{activeSettings.height}
                  </div>
                </div>
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="space-y-4">
              <div className="flex items-center justify-between group cursor-pointer">
                <h4 className="font-sans text-[10px] uppercase tracking-widest text-[#b9caca] font-bold border-l-2 border-[#00f5ff] pl-3">Advanced Config</h4>
                <ChevronDown className="w-4 h-4 text-[#b9caca]" />
              </div>
              
              <div className="space-y-4 bg-[#0a0e14]/30 p-4 border border-[#3a494a]/10">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#dfe2eb]">Compression</span>
                  <select 
                    value={activeSettings.compression}
                    onChange={(e) => updateSettings({ compression: e.target.value as CompressionType })}
                    className="bg-[#1c2026] border border-[#3a494a]/30 text-[#dfe2eb] text-[10px] py-1 px-2 outline-none"
                  >
                    <option value="none">None</option>
                    <option value="rle">RLE</option>
                    <option value="delta">Delta</option>
                  </select>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#dfe2eb]">Target FPS</span>
                  <input 
                    type="number" 
                    value={activeSettings.targetFps}
                    onChange={(e) => updateSettings({ targetFps: parseInt(e.target.value) || 15 })}
                    className="w-12 bg-[#0a0e14] border border-[#3a494a]/30 text-center text-xs py-0.5 outline-none" 
                  />
                </div>
                
                <div className="pt-4 border-t border-[#3a494a]/10">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-[10px] text-[#b9caca]">RAM Est. Per File</span>
                    <span className="text-[12px] font-bold text-[#3bff17]">
                      {selectedFile ? (selectedFile.binary.length / 1024).toFixed(1) : '0.0'} KB
                    </span>
                  </div>
                  <div className="h-1 w-full bg-[#0a0e14]">
                    <div 
                      className="h-full bg-[#3bff17]" 
                      style={{ width: `${Math.min(100, (selectedFile?.binary.length || 0) / (32 * 1024) * 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => processFiles(settingsTab === 'global' ? files : (selectedFile ? [selectedFile] : []))}
              className="w-full bg-[#31353c] text-[#dfe2eb] py-2 text-xs font-sans uppercase hover:bg-[#3a494a] transition-colors"
            >
              Apply Settings
            </button>
          </div>

          {/* Footer Stats */}
          <div className="p-6 bg-[#31353c]/20 border-t border-[#3a494a]/10 shrink-0">
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-sans uppercase text-[#b9caca]">Batch Size</span>
                <span className="text-[11px] font-bold text-[#dfe2eb]">
                  {(totalSize / 1024).toFixed(1)} KB <span className="text-[#849495]">/ {(flashLimit / 1024).toFixed(0)} KB</span>
                </span>
              </div>
              <div className="h-1.5 w-full bg-[#0a0e14] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[#00f5ff] to-[#7805c3]" 
                  style={{ width: `${Math.min(100, (totalSize / flashLimit) * 100)}%` }}
                ></div>
              </div>
              <p className="text-[9px] text-[#b9caca] leading-tight">Total Combined Size: {(totalSize / 1024).toFixed(1)}KB / 512KB Flash Limit</p>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
