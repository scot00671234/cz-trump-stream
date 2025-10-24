// ========================================
// FULLY AUTOMATIC LIVESTREAMER v3.0
// ========================================
const ffmpeg = require('fluent-ffmpeg');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 FULLY AUTOMATIC LIVESTREAMER v3.0 STARTING...');

// Configuration
const VIDEO_URLS = [
  'https://www.dropbox.com/scl/fi/nw0nktpbqx255ntggietr/1024.mp4?rlkey=c5aiahb9rehc595im5qcpf2nb&st=43r3qd80&dl=1',
  'https://www.dropbox.com/scl/fi/ew3j68ribsulpf70yr7cm/czump.mp4?rlkey=yuo9jfkr6eorwh5cjqgngn45v&st=ut67nx1a&dl=1'
];

// Ultimate fallback - Embedded Pepe image when everything fails
const FALLBACK_IMAGE_SVG = `data:image/svg+xml;base64,${Buffer.from(`
<svg width="400" height="300" viewBox="0 0 400 300" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="300" fill="#80d380"/>
  <rect x="100" y="50" width="200" height="200" rx="10" fill="#60a660"/>
  <circle cx="150" cy="120" r="15" fill="#000000"/>
  <circle cx="250" cy="120" r="15" fill="#000000"/>
  <rect x="140" y="150" width="120" height="10" rx="5" fill="#000000"/>
  <rect x="170" y="200" width="60" height="40" rx="5" fill="#ffffff"/>
  <text x="200" y="225" font-family="Arial" font-size="14" fill="#000000" text-anchor="middle">PEPE</text>
</svg>`).toString('base64')}`;
const STREAM_KEY = 'aBgtzPvqs4fA';

// Multiple RTMP endpoints for fallback
const RTMP_ENDPOINTS = [
  'rtmps://pump-prod-tg2x8veh.rtmp.livekit.cloud/x',
  'rtmps://pump-prod-tg2x8veh.rtmp.livekit.cloud/x',
  'rtmps://pump-prod-tg2x8veh.rtmp.livekit.cloud/x'
];

// Streaming configurations - Force complete video playback
const STREAMING_CONFIGS = [
  {
    name: 'Force Complete',
    inputOptions: ['-re', '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-analyzeduration', '100000', '-probesize', '100000', '-rtbufsize', '1000M', '-max_delay', '20000000', '-thread_queue_size', '4096', '-max_muxing_queue_size', '1024'],
    outputOptions: ['-vf', 'scale=480:270', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '45', '-maxrate', '100k', '-bufsize', '50k', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '16k', '-ar', '22050', '-ac', '1', '-f', 'flv', '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-max_muxing_queue_size', '1024']
  },
  {
    name: 'Ultra Minimal',
    inputOptions: ['-re', '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-analyzeduration', '50000', '-probesize', '50000', '-rtbufsize', '2000M', '-max_delay', '30000000', '-thread_queue_size', '8192', '-max_muxing_queue_size', '2048'],
    outputOptions: ['-vf', 'scale=480:270', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '50', '-maxrate', '50k', '-bufsize', '25k', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '8k', '-ar', '22050', '-ac', '1', '-f', 'flv', '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-max_muxing_queue_size', '2048']
  },
  {
    name: 'Absolute Minimal',
    inputOptions: ['-re', '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-analyzeduration', '10000', '-probesize', '10000', '-rtbufsize', '5000M', '-max_delay', '60000000', '-thread_queue_size', '16384', '-max_muxing_queue_size', '4096'],
    outputOptions: ['-vf', 'scale=320:180', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '55', '-maxrate', '25k', '-bufsize', '12k', '-g', '120', '-keyint_min', '120', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '4k', '-ar', '22050', '-ac', '1', '-f', 'flv', '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-max_muxing_queue_size', '4096']
  }
];

// Global variables
let streamProcess = null;
let isStreaming = false;
let currentEndpointIndex = 0;
let currentConfigIndex = 0;
let currentVideoIndex = 0;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;
let healthCheckInterval = null;
let videoRotationInterval = null;
let lastStreamActivity = Date.now();
const VIDEO_ROTATION_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Pre-loading system
let preloadedVideos = new Map();
let isPreloading = false;
const PRELOAD_TIMEOUT = 300000; // 5 minutes max preload time

// Fallback mode variables
let isFallbackMode = false;
let fallbackAttempts = 0;
const MAX_FALLBACK_ATTEMPTS = 5;

// Smooth transition variables
let isTransitioning = false;
let nextVideoIndex = 0;
let transitionTimeout = null;
const TRANSITION_DURATION = 3000; // 3 seconds for smooth transition

// Video validation function
function validateVideoUrl(url) {
  // Check if URL has proper dl=1 parameter for Dropbox
  if (url.includes('dropbox.com') && !url.includes('dl=1')) {
    console.log('⚠️ Warning: Dropbox URL missing dl=1 parameter');
    return false;
  }
  return true;
}

// Pre-load video function - downloads and processes video for instant streaming
async function preloadVideo(videoUrl, videoIndex) {
  if (preloadedVideos.has(videoIndex)) {
    console.log('✅ Video ' + (videoIndex + 1) + ' already preloaded');
    return true;
  }

  console.log('🔄 PRELOADING Video ' + (videoIndex + 1) + ' for instant streaming...');
  console.log('URL: ' + videoUrl);
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    let preloadProcess = null;
    let isResolved = false;
    
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        console.log('⏰ Preload timeout for video ' + (videoIndex + 1));
        if (preloadProcess) {
          preloadProcess.kill('SIGTERM');
        }
        resolve(false);
      }
    }, PRELOAD_TIMEOUT);

    try {
      // Use ffmpeg to analyze and preload the video with proper output
      preloadProcess = ffmpeg()
        .input(videoUrl)
        .inputOptions(['-analyzeduration', '5000000', '-probesize', '5000000'])
        .outputOptions(['-f', 'null', '-', '-v', 'quiet']) // Null output with quiet mode
        .on('start', (commandLine) => {
          console.log('🚀 Preload started for video ' + (videoIndex + 1));
        })
        .on('progress', (progress) => {
          const elapsed = Date.now() - startTime;
          console.log('📥 Preloading: ' + Math.round(progress.percent || 0) + '% done (' + Math.round(elapsed/1000) + 's)');
        })
        .on('end', () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            const elapsed = Date.now() - startTime;
            console.log('✅ Video ' + (videoIndex + 1) + ' preloaded successfully in ' + Math.round(elapsed/1000) + 's');
            preloadedVideos.set(videoIndex, {
              url: videoUrl,
              preloaded: true,
              timestamp: Date.now()
            });
            resolve(true);
          }
        })
        .on('error', (err) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            console.log('❌ Preload failed for video ' + (videoIndex + 1) + ': ' + err.message);
            resolve(false);
          }
        });

      preloadProcess.run();
      
    } catch (error) {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeout);
        console.log('❌ Preload error for video ' + (videoIndex + 1) + ': ' + error.message);
        resolve(false);
      }
    }
  });
}

// Pre-load all videos function
async function preloadAllVideos() {
  if (isPreloading) {
    console.log('⚠️ Preloading already in progress');
    return;
  }
  
  isPreloading = true;
  console.log('🔄 PRELOADING ALL VIDEOS FOR INSTANT STREAMING...');
  
  const preloadPromises = VIDEO_URLS.map((url, index) => preloadVideo(url, index));
  
  try {
    const results = await Promise.all(preloadPromises);
    const successCount = results.filter(r => r).length;
    console.log('✅ Preloading complete: ' + successCount + '/' + VIDEO_URLS.length + ' videos ready');
    isPreloading = false;
    return successCount > 0;
  } catch (error) {
    console.log('❌ Preloading failed: ' + error.message);
    isPreloading = false;
    return false;
  }
}

// Stream health monitoring
function startHealthMonitoring() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  healthCheckInterval = setInterval(() => {
    if (isStreaming) {
      const timeSinceLastActivity = Date.now() - lastStreamActivity;
      if (timeSinceLastActivity > 600000) { // Increased timeout to 10 minutes for processing
        console.log('Stream timeout detected - restarting...');
        restartStream();
      }
    }
  }, 60000); // Check every 60 seconds
}

function stopHealthMonitoring() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// Video rotation functions
function startVideoRotation() {
  if (videoRotationInterval) {
    clearInterval(videoRotationInterval);
  }
  
  // Rotate videos every 5 minutes
  videoRotationInterval = setInterval(() => {
    if (isStreaming && !isFallbackMode) {
      console.log('🔄 Time-based rotation to next video...');
      rotateToNextVideo();
    }
  }, VIDEO_ROTATION_INTERVAL);
}

function stopVideoRotation() {
  if (videoRotationInterval) {
    clearInterval(videoRotationInterval);
    videoRotationInterval = null;
  }
}

function rotateToNextVideo() {
  if (isTransitioning) {
    console.log('⚠️ Transition already in progress, skipping...');
    return;
  }
  
  const previousVideo = currentVideoIndex + 1;
  nextVideoIndex = (currentVideoIndex + 1) % VIDEO_URLS.length;
  const nextVideo = nextVideoIndex + 1;
  
  console.log('🔄 SMOOTH VIDEO TRANSITION:');
  console.log('   Previous: Video ' + previousVideo + '/' + VIDEO_URLS.length);
  console.log('   Next: Video ' + nextVideo + '/' + VIDEO_URLS.length);
  console.log('   URL: ' + VIDEO_URLS[nextVideoIndex]);
  
  startSmoothTransition();
}

function startSmoothTransition() {
  isTransitioning = true;
  
  console.log('🎬 Starting smooth transition with Pepe fallback...');
  
  // Stop current stream
  if (streamProcess) {
    streamProcess.kill('SIGTERM');
    streamProcess = null;
  }
  
  isStreaming = false;
  stopHealthMonitoring();
  stopVideoRotation();
  
  // Start fallback image during transition
  startTransitionFallback();
}

function startTransitionFallback() {
  console.log('🖼️ Showing Pepe fallback during transition...');
  
  try {
    const config = STREAMING_CONFIGS[2]; // Use stable config
    const endpoint = RTMP_ENDPOINTS[currentEndpointIndex];
    const rtmpUrl = endpoint + '/' + STREAM_KEY;
    
    streamProcess = ffmpeg()
      .input(FALLBACK_IMAGE_SVG)
      .inputOptions(['-loop', '1', '-r', '1', '-t', Math.floor(TRANSITION_DURATION / 1000)]) // Short duration for transition
      .outputOptions(['-vf', 'scale=1280:720', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-crf', '30', '-maxrate', '500k', '-bufsize', '500k', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '32k', '-ar', '44100', '-ac', '2', '-f', 'flv'])
      .output(rtmpUrl)
      .on('start', (commandLine) => {
        console.log('✅ Transition fallback started');
        isStreaming = true;
        lastStreamActivity = Date.now();
        startHealthMonitoring();
      })
      .on('end', () => {
        console.log('🎥 Transition fallback ended, starting next video...');
        isStreaming = false;
        stopHealthMonitoring();
        
        // Switch to next video after transition
        currentVideoIndex = nextVideoIndex;
        setTimeout(() => {
          isTransitioning = false;
          startStream();
        }, 1000);
      })
      .on('error', (err) => {
        console.error('❌ Transition fallback error:', err.message);
        isStreaming = false;
        stopHealthMonitoring();
        
        // Skip transition and go directly to next video
        currentVideoIndex = nextVideoIndex;
        isTransitioning = false;
        setTimeout(() => {
          startStream();
        }, 1000);
      });

    streamProcess.run();
    
  } catch (error) {
    console.error('Error starting transition fallback:', error);
    // Skip transition and go directly to next video
    currentVideoIndex = nextVideoIndex;
    isTransitioning = false;
    setTimeout(() => {
      startStream();
    }, 1000);
  }
}

// Ultimate fallback mode - use static Pepe image
function startFallbackMode() {
  console.log('🚨 ENTERING ULTIMATE FALLBACK MODE - PEPE IMAGE');
  console.log('🔄 All video sources failed, using static Pepe image as last resort');
  
  isFallbackMode = true;
  fallbackAttempts++;
  
  if (streamProcess) {
    streamProcess.kill('SIGTERM');
    streamProcess = null;
  }
  
  isStreaming = false;
  stopHealthMonitoring();
  stopVideoRotation();
  
  setTimeout(() => {
    startFallbackStream();
  }, 3000);
}

function startFallbackStream() {
  if (isStreaming) {
    return;
  }

  console.log('🖼️ Starting fallback stream with Pepe image...');
  
  try {
    const config = STREAMING_CONFIGS[2]; // Use ultra stable config
    const endpoint = RTMP_ENDPOINTS[currentEndpointIndex]; // Use current endpoint
    const rtmpUrl = endpoint + '/' + STREAM_KEY;
    
    console.log('Using fallback config: ' + config.name);
    console.log('Using endpoint: ' + endpoint);
    console.log('Using embedded fallback image (SVG)');
    
    streamProcess = ffmpeg()
      .input(FALLBACK_IMAGE_SVG)
      .inputOptions(['-loop', '1', '-r', '1', '-t', '3600']) // Loop image for 1 hour
      .outputOptions(['-vf', 'scale=1280:720', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-crf', '30', '-maxrate', '500k', '-bufsize', '500k', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '32k', '-ar', '44100', '-ac', '2', '-f', 'flv'])
      .output(rtmpUrl)
      .on('start', (commandLine) => {
        console.log('✅ Fallback stream started successfully');
        console.log('FFmpeg command:', commandLine);
        isStreaming = true;
        lastStreamActivity = Date.now();
        startHealthMonitoring();
      })
      .on('progress', (progress) => {
        console.log('Fallback processing: ' + progress.percent + '% done');
        lastStreamActivity = Date.now();
      })
      .on('error', (err) => {
        console.error('❌ Fallback streaming error:', err.message);
        
        isStreaming = false;
        stopHealthMonitoring();
        
        if (fallbackAttempts < MAX_FALLBACK_ATTEMPTS) {
          fallbackAttempts++;
          console.log('🔄 Retrying fallback stream (attempt ' + fallbackAttempts + '/' + MAX_FALLBACK_ATTEMPTS + ')...');
          
          // Try different endpoint
          currentEndpointIndex = (currentEndpointIndex + 1) % RTMP_ENDPOINTS.length;
          console.log('Trying endpoint: ' + RTMP_ENDPOINTS[currentEndpointIndex]);
          
          setTimeout(() => {
            startFallbackStream();
          }, 5000);
        } else {
          console.error('❌ All fallback attempts exhausted - stream offline');
        }
      })
      .on('end', () => {
        console.log('Fallback stream ended');
        isStreaming = false;
        stopHealthMonitoring();
      });

    streamProcess.run();
    
  } catch (error) {
    console.error('Error starting fallback stream:', error);
    isStreaming = false;
  }
}

// Restart stream function
function restartStream() {
  console.log('🔄 Restarting stream...');
  
  if (streamProcess) {
    streamProcess.kill('SIGTERM');
    streamProcess = null;
  }
  
  isStreaming = false;
  stopHealthMonitoring();
  
  // Check if we should enter fallback mode
  if (restartAttempts >= MAX_RESTART_ATTEMPTS && !isFallbackMode) {
    console.log('🚨 Max restart attempts reached - entering fallback mode');
    startFallbackMode();
    return;
  }
  
  // Try different approach
  currentConfigIndex = (currentConfigIndex + 1) % STREAMING_CONFIGS.length;
  if (currentConfigIndex === 0) {
    currentEndpointIndex = (currentEndpointIndex + 1) % RTMP_ENDPOINTS.length;
  }
  
  setTimeout(() => {
    startStream();
  }, 2000);
}

// Start streaming function
function startStream() {
  if (isStreaming) {
    return;
  }

  console.log('🎥 Starting automatic stream...');
  
  try {
    const config = STREAMING_CONFIGS[currentConfigIndex];
    const endpoint = RTMP_ENDPOINTS[currentEndpointIndex];
    const rtmpUrl = endpoint + '/' + STREAM_KEY;
    const currentVideoUrl = VIDEO_URLS[currentVideoIndex];
    
    // Check if video is preloaded
    const isPreloaded = preloadedVideos.has(currentVideoIndex);
    
    // Validate video URL
    if (!validateVideoUrl(currentVideoUrl)) {
      console.log('⚠️ Video URL validation failed, rotating to next video...');
      rotateToNextVideo();
      return;
    }
    
    console.log('📺 STREAM SETUP:');
    console.log('   Config: ' + config.name);
    console.log('   Endpoint: ' + endpoint);
    console.log('   Video: ' + (currentVideoIndex + 1) + '/' + VIDEO_URLS.length);
    console.log('   Preloaded: ' + (isPreloaded ? '✅ YES' : '❌ NO'));
    console.log('   URL: ' + currentVideoUrl);
    
    streamProcess = ffmpeg()
      .input(currentVideoUrl)
      .inputOptions(config.inputOptions)
      .outputOptions(config.outputOptions)
      .output(rtmpUrl)
      .addOption('-threads', '0') // Use all available CPU threads
      .addOption('-movflags', '+faststart') // Optimize for streaming
      .on('start', (commandLine) => {
        console.log('✅ Stream started successfully');
        console.log('FFmpeg command:', commandLine);
        isStreaming = true;
        lastStreamActivity = Date.now();
        startHealthMonitoring();
        startVideoRotation();
      })
      .on('progress', (progress) => {
        console.log('Processing: ' + progress.percent + '% done');
        lastStreamActivity = Date.now();
      })
      .on('error', (err) => {
        console.error('❌ Streaming error:', err.message);
        console.error('Error code:', err.code);
        
        isStreaming = false;
        stopHealthMonitoring();
        stopVideoRotation();
        
        if (restartAttempts < MAX_RESTART_ATTEMPTS) {
          restartAttempts++;
          console.log('🔄 Auto-restarting stream (attempt ' + restartAttempts + '/' + MAX_RESTART_ATTEMPTS + ')...');
          restartStream();
        } else {
          console.error('❌ Max restart attempts reached');
        }
      })
      .on('end', () => {
        console.log('Stream ended - video finished playing');
        isStreaming = false;
        stopHealthMonitoring();
        stopVideoRotation();
        
        // If not in fallback mode and not already transitioning, start smooth transition
        if (!isFallbackMode && !isTransitioning) {
          console.log('🎥 Video finished, starting smooth transition...');
          setTimeout(() => {
            rotateToNextVideo();
          }, 1000);
        }
      });

    streamProcess.run();
    
  } catch (error) {
    console.error('Error starting stream:', error);
    isStreaming = false;
  }
}

// Simple status endpoint
app.get('/status', (req, res) => {
  res.json({
    streaming: isStreaming,
    currentConfig: STREAMING_CONFIGS[currentConfigIndex].name,
    currentEndpoint: RTMP_ENDPOINTS[currentEndpointIndex],
    currentVideo: isFallbackMode ? 'FALLBACK' : (isTransitioning ? 'TRANSITIONING' : (currentVideoIndex + 1)),
    totalVideos: isFallbackMode ? 'FALLBACK' : VIDEO_URLS.length,
    currentVideoUrl: isFallbackMode ? 'EMBEDDED_SVG' : (isTransitioning ? 'TRANSITION_SVG' : VIDEO_URLS[currentVideoIndex]),
    isFallbackMode: isFallbackMode,
    isTransitioning: isTransitioning,
    nextVideo: isTransitioning ? (nextVideoIndex + 1) : null,
    restartAttempts: restartAttempts,
    fallbackAttempts: fallbackAttempts,
    timestamp: new Date().toISOString()
  });
});

// Simple status page
app.get('/', (req, res) => {
  let statusHtml = 'Stopped';
  if (isStreaming) {
    if (isFallbackMode) {
      statusHtml = 'Fallback Mode';
    } else if (isTransitioning) {
      statusHtml = 'Transitioning';
    } else {
      statusHtml = 'Streaming';
    }
  }
  
  const configName = STREAMING_CONFIGS[currentConfigIndex].name;
  const endpointNum = currentEndpointIndex + 1;
  let videoNum = currentVideoIndex + 1;
  if (isFallbackMode) {
    videoNum = 'FALLBACK';
  } else if (isTransitioning) {
    videoNum = 'TRANSITIONING';
  }
  
  const html = '<html><head><title>Pepe Livestreamer - Auto Mode</title>' +
    '<style>body{font-family:Arial,sans-serif;margin:40px;background:#f5f5f5}' +
    '.status-card{background:white;padding:30px;border-radius:15px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:600px;margin:0 auto}' +
    '.status{font-size:28px;font-weight:bold;margin:20px 0}' +
    '.streaming{color:#4CAF50}' +
    '.transition{color:#2196F3}' +
    '.fallback{color:#ff6b35}' +
    '.stopped{color:#f44336}' +
    '.info{margin:15px 0;font-size:16px}' +
    '.auto-badge{background:#4CAF50;color:white;padding:5px 15px;border-radius:20px;font-size:14px}' +
    '</style></head><body>' +
    '<div class="status-card">' +
    '<h1>🎥 Pepe Livestreamer</h1>' +
    '<div class="auto-badge">FULLY AUTOMATIC</div>' +
    '<p class="status" id="status">' + statusHtml + '</p>' +
    '<div class="info">' +
    '<p><strong>Mode:</strong> Fully Automatic</p>' +
    '<p><strong>Current Config:</strong> <span id="config">' + configName + '</span></p>' +
    '<p><strong>Endpoint:</strong> <span id="endpoint">' + endpointNum + '/3</span></p>' +
    '<p><strong>Current Video:</strong> <span id="video">' + videoNum + (isFallbackMode ? '' : ('/' + VIDEO_URLS.length)) + '</span></p>' +
    '<p><strong>Restart Attempts:</strong> <span id="attempts">' + restartAttempts + '</span></p>' +
    (isFallbackMode ? '<p><strong>Fallback Mode:</strong> <span style="color:#ff6b35;font-weight:bold">ACTIVE - EMBEDDED PEPE SVG</span></p>' : '') +
    (isTransitioning ? '<p><strong>Transition:</strong> <span style="color:#2196F3;font-weight:bold">SHOWING PEPE → VIDEO ' + (nextVideoIndex + 1) + '</span></p>' : '') +
    '</div>' +
    '<p style="color:#666;font-style:italic;margin-top:30px">' +
    '🚀 Stream runs automatically on deployment<br>' +
    '🔄 Auto-restarts on any error<br>' +
    '🎥 Rotates between multiple videos every 5 minutes<br>' +
    '🛡️ Multiple fallback configurations<br>' +
    '🖼️ Ultimate fallback: Pepe image when all else fails<br>' +
    '⚡ No manual intervention needed!' +
    '</p>' +
    '</div>' +
    '<script>' +
    'async function updateStatus(){' +
    'try{' +
    'const response=await fetch("/status");' +
    'const data=await response.json();' +
    'let statusText="Stopped";' +
    'let statusClass="status stopped";' +
    'if(data.streaming){' +
    '  if(data.isFallbackMode){statusText="Fallback Mode";statusClass="status fallback";}' +
    '  else if(data.isTransitioning){statusText="Transitioning";statusClass="status transition";}' +
    '  else{statusText="Streaming";statusClass="status streaming";}' +
    '}' +
    'document.getElementById("status").textContent=statusText;' +
    'document.getElementById("status").className=statusClass;' +
    'document.getElementById("config").textContent=data.currentConfig;' +
    'let videoText=data.currentVideo;' +
    'if(!data.isFallbackMode&&!data.isTransitioning){videoText+="/"+data.totalVideos;}' +
    'document.getElementById("video").textContent=videoText;' +
    'document.getElementById("attempts").textContent=data.restartAttempts;' +
    '}catch(error){' +
    'console.error("Error updating status:",error);' +
    '}' +
    '}' +
    'setInterval(updateStatus,5000);' +
    'updateStatus();' +
    '</script>' +
    '</body></html>';
  
  res.send(html);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    streaming: isStreaming,
    timestamp: new Date().toISOString()
  });
});

// Manual rotation endpoint for testing
app.post('/rotate', (req, res) => {
  if (isStreaming && !isFallbackMode) {
    console.log('🔄 Manual rotation triggered via API');
    rotateToNextVideo();
    res.json({ 
      success: true, 
      message: 'Video rotation triggered',
      currentVideo: currentVideoIndex + 1,
      totalVideos: VIDEO_URLS.length
    });
  } else {
    res.json({ 
      success: false, 
      message: 'Cannot rotate - not streaming or in fallback mode',
      streaming: isStreaming,
      fallbackMode: isFallbackMode
    });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  if (streamProcess) {
    streamProcess.kill('SIGTERM');
  }
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  if (videoRotationInterval) {
    clearInterval(videoRotationInterval);
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  if (streamProcess) {
    streamProcess.kill('SIGTERM');
  }
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  if (videoRotationInterval) {
    clearInterval(videoRotationInterval);
  }
  process.exit(0);
});

// Start server and auto-start stream
app.listen(PORT, () => {
  console.log('=== FULLY AUTOMATIC LIVESTREAMER v3.0 ===');
  console.log('Server running on port ' + PORT);
  console.log('Status page: http://localhost:' + PORT + '/');
  console.log('🚀 PRELOADING VIDEOS FOR INSTANT STREAMING...');
  
  // Preload all videos first, then start streaming
  preloadAllVideos().then((success) => {
    if (success) {
      console.log('✅ PRELOADING COMPLETE - STARTING STREAM...');
      setTimeout(() => {
        console.log('🎥 AUTO-STARTING STREAM NOW...');
        startStream();
      }, 2000);
    } else {
      console.log('⚠️ PRELOADING FAILED - STARTING STREAM ANYWAY...');
      setTimeout(() => {
        console.log('🎥 AUTO-STARTING STREAM NOW...');
        startStream();
      }, 5000);
    }
  });
});