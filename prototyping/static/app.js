/**
 * Iris Voice Agent - Main Client Application
 * Connects WebRTC pipeline, Web Audio API analyzers, DataChannel events, and UI state.
 */

import { NeuralOrbVisualizer } from './orb_visualizer.js';

class VoiceAgentApp {
  constructor() {
    // State
    this.isConnected = false;
    this.isConnecting = false;
    this.isMuted = false;
    this.sessionId = null;
    this.sessionStartTime = null;
    this.timerInterval = null;
    this.keepAliveInterval = null;

    // WebRTC & Audio
    this.pc = null;
    this.dc = null;
    this.localStream = null;
    this.audioCtx = null;
    this.micAnalyser = null;
    this.botAnalyser = null;
    this.remoteAudioEl = document.getElementById('remote-audio');

    // Visualizers
    this.orbCanvas = document.getElementById('neural-orb-canvas');
    this.orb = new NeuralOrbVisualizer(this.orbCanvas);
    this.micWaveCanvas = document.getElementById('mic-wave-canvas');
    this.botWaveCanvas = document.getElementById('bot-wave-canvas');
    this.micWaveCtx = this.micWaveCanvas.getContext('2d');
    this.botWaveCtx = this.botWaveCanvas.getContext('2d');

    // UI Elements
    this.btnConnect = document.getElementById('btn-connect');
    this.btnMute = document.getElementById('btn-mute');
    this.btnInterrupt = document.getElementById('btn-interrupt');
    this.btnSendText = document.getElementById('btn-send-text');
    this.chatTextInput = document.getElementById('chat-text-input');
    
    this.statusPill = document.getElementById('connection-status');
    this.statusText = document.getElementById('status-text');
    this.stageStateBadge = document.getElementById('stage-state-badge');
    this.stateBadgeText = document.getElementById('state-badge-text');
    this.sessionTimer = document.getElementById('session-timer');

    this.transcriptFeed = document.getElementById('transcript-feed');
    this.emptyTranscript = document.getElementById('empty-transcript');
    this.transcriptFilter = document.getElementById('transcript-filter');
    this.btnCopyTranscript = document.getElementById('btn-copy-transcript');
    this.btnExportTranscript = document.getElementById('btn-export-transcript');
    this.btnClearTranscript = document.getElementById('btn-clear-transcript');
    this.transcriptCountBadge = document.getElementById('transcript-count-badge');

    this.ragLiveFeed = document.getElementById('rag-live-feed');
    this.questionBankTree = document.getElementById('question-bank-tree');
    this.ragCountBadge = document.getElementById('rag-count-badge');

    this.micSelect = document.getElementById('mic-select');
    this.speakerSelect = document.getElementById('speaker-select');
    this.echoCancellationToggle = document.getElementById('echo-cancellation-toggle');
    this.noiseSuppressionToggle = document.getElementById('noise-suppression-toggle');
    this.autoGainToggle = document.getElementById('auto-gain-toggle');

    this.micFill = document.getElementById('mic-hud-fill');
    this.botFill = document.getElementById('bot-hud-fill');

    // Transcript Data Store
    this.messages = [];
    this.activeInterviewerMsgEl = null;
    this.interimUserMsgEl = null;
    this.retrievalCount = 0;

    this.init();
  }

  async init() {
    this.checkSecureContext();
    this.bindEvents();
    this.loadQuestionBank();
    await this.populateAudioDevices();
    this.startMiniVisualizers();
  }

  bindEvents() {
    // Primary Connect/Disconnect Button
    this.btnConnect.addEventListener('click', () => this.toggleConnection());

    // Mic Mute Toggle
    this.btnMute.addEventListener('click', () => this.toggleMute());

    // Interrupt AI Button
    this.btnInterrupt.addEventListener('click', () => this.interruptAI());

    // Fallback Text Input
    this.btnSendText.addEventListener('click', () => this.sendTextMessage());
    this.chatTextInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendTextMessage();
    });

    // Domain Chips
    document.querySelectorAll('.role-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.role-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        const role = chip.dataset.role;
        this.selectInterviewDomain(role);
      });
    });

    // Tabs Navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabTarget = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel-tab-view').forEach(v => v.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-view-${tabTarget}`)?.classList.add('active');
      });
    });

    // Transcript Actions
    this.transcriptFilter.addEventListener('input', (e) => this.filterTranscript(e.target.value));
    this.btnCopyTranscript.addEventListener('click', () => this.copyTranscript());
    this.btnExportTranscript.addEventListener('click', () => this.exportTranscript());
    this.btnClearTranscript.addEventListener('click', () => this.clearTranscript());

    // Settings
    this.micSelect.addEventListener('change', () => this.changeAudioInputDevice());
    this.speakerSelect.addEventListener('change', () => this.changeAudioOutputDevice());
  }

  /* ==========================================================================
     WEBRTC & AUDIO CONNECTION PIPELINE
     ========================================================================== */

  async toggleConnection() {
    if (this.isConnected) {
      await this.disconnect();
    } else {
      await this.connect();
    }
  }

  async getMediaStreamSafe(constraints) {
    // 1. Standard modern mediaDevices API
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      return await navigator.mediaDevices.getUserMedia(constraints);
    }

    // 2. Legacy browser APIs
    const legacyGetUserMedia =
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia ||
      navigator.msGetUserMedia;

    if (legacyGetUserMedia) {
      return new Promise((resolve, reject) => {
        legacyGetUserMedia.call(navigator, constraints, resolve, reject);
      });
    }

    // 3. Informative error message regarding Secure Context requirements
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '[::1]';

    if (!window.isSecureContext && !isLocalhost) {
      throw new Error(
        `Microphone access (getUserMedia) is blocked by your browser because this page is not in a Secure Context (${window.location.origin}). ` +
        `Please open the app via http://localhost:${window.location.port || '7860'} or http://127.0.0.1:${window.location.port || '7860'}`
      );
    }

    throw new Error(
      'Microphone access (navigator.mediaDevices.getUserMedia) is not available. Please check browser permissions and ensure you are using a modern browser.'
    );
  }

  checkSecureContext() {
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '[::1]';

    if (!window.isSecureContext && !isLocalhost) {
      const existing = document.getElementById('insecure-context-warning');
      if (existing) return;

      const banner = document.createElement('div');
      banner.id = 'insecure-context-warning';
      banner.style.cssText = `
        background: linear-gradient(90deg, #be123c, #9f1239);
        color: #ffffff;
        padding: 10px 20px;
        text-align: center;
        font-size: 13px;
        font-weight: 500;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
      `;
      const localUrl = `http://localhost:${window.location.port || '7860'}${window.location.pathname}`;
      banner.innerHTML = `
        <span>⚠️ <strong>Microphone Restricted:</strong> Browsers block microphone access on non-localhost HTTP addresses (<code>${window.location.hostname}</code>).</span>
        <a href="${localUrl}" style="background: #ffffff; color: #9f1239; padding: 4px 12px; border-radius: 4px; font-weight: 700; text-decoration: none;">Switch to http://localhost:${window.location.port || '7860'}</a>
      `;
      document.body.prepend(banner);
    }
  }

  async connect() {
    if (this.isConnecting || this.isConnected) return;
    this.isConnecting = true;
    this.setConnectionState('connecting', 'Connecting...');
    this.orb.setState('thinking');

    try {
      // 1. Initialize Web Audio Context
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Web Audio API is not supported in this browser.');
      }
      this.audioCtx = new AudioContextClass();
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      // 2. Request Candidate Microphone safely
      const constraints = {
        audio: {
          deviceId: this.micSelect?.value ? { exact: this.micSelect.value } : undefined,
          echoCancellation: this.echoCancellationToggle?.checked ?? true,
          noiseSuppression: this.noiseSuppressionToggle?.checked ?? true,
          autoGainControl: this.autoGainToggle?.checked ?? true
        },
        video: false
      };

      try {
        this.localStream = await this.getMediaStreamSafe(constraints);
      } catch (micErr) {
        if (constraints.audio.deviceId) {
          console.warn('Retrying getUserMedia with default audio device...');
          this.localStream = await this.getMediaStreamSafe({ audio: true, video: false });
        } else {
          throw micErr;
        }
      }

      // Connect Mic Analyser
      const micSource = this.audioCtx.createMediaStreamSource(this.localStream);
      this.micAnalyser = this.audioCtx.createAnalyser();
      this.micAnalyser.fftSize = 512;
      this.micAnalyser.smoothingTimeConstant = 0.4;
      micSource.connect(this.micAnalyser);
      this.orb.setMicAnalyser(this.micAnalyser);

      // 3. Initiate session with backend (/start)
      const startRes = await fetch('/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transport: 'webrtc',
          enableDefaultIceServers: true,
          body: {}
        })
      });

      if (!startRes.ok) {
        throw new Error(`Failed to start WebRTC session (Status: ${startRes.status})`);
      }

      const startData = await startRes.json();
      this.sessionId = startData.sessionId;
      const iceServers = startData.iceConfig?.iceServers || [{ urls: ['stun:stun.l.google.com:19302'] }];

      // 4. Create RTCPeerConnection
      this.pc = new RTCPeerConnection({ iceServers });

      // Add local audio tracks to peer connection
      this.localStream.getTracks().forEach(track => {
        this.pc.addTrack(track, this.localStream);
      });

      // Add transceivers
      this.pc.addTransceiver('audio', { direction: 'sendrecv' });

      // 5. Create Data Channel for real-time transcript & events
      this.dc = this.pc.createDataChannel('chat', { ordered: true });
      this.setupDataChannel(this.dc);

      // Handle remote audio track from Iris
      this.pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
          this.remoteAudioEl.srcObject = event.streams[0] || new MediaStream([event.track]);
          this.remoteAudioEl.play().catch(e => console.warn('Audio autoplay blocked:', e));

          // Connect Bot Analyser for Iris Voice Visualization
          try {
            const botStream = new MediaStream([event.track]);
            const botSource = this.audioCtx.createMediaStreamSource(botStream);
            this.botAnalyser = this.audioCtx.createAnalyser();
            this.botAnalyser.fftSize = 512;
            this.botAnalyser.smoothingTimeConstant = 0.3;
            botSource.connect(this.botAnalyser);
            this.orb.setBotAnalyser(this.botAnalyser);
          } catch (err) {
            console.error('Error connecting bot audio analyzer:', err);
          }
        }
      };

      // 6. Generate SDP Offer
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Wait briefly for ICE candidates gathering (or immediate send)
      await new Promise(resolve => {
        if (this.pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          const checkState = () => {
            if (this.pc.iceGatheringState === 'complete') {
              this.pc.removeEventListener('icegatheringstatechange', checkState);
              resolve();
            }
          };
          this.pc.addEventListener('icegatheringstatechange', checkState);
          setTimeout(resolve, 500); // 500ms timeout
        }
      });

      // 7. Send offer to /api/offer or /sessions/{sessionId}/api/offer
      const offerUrl = this.sessionId ? `/sessions/${this.sessionId}/api/offer` : '/api/offer';
      const offerRes = await fetch(offerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: this.pc.localDescription.sdp,
          type: this.pc.localDescription.type,
          pc_id: null,
          restart_pc: false,
          request_data: {}
        })
      });

      if (!offerRes.ok) {
        throw new Error(`Failed to exchange SDP offer (Status: ${offerRes.status})`);
      }

      const answerData = await offerRes.json();
      await this.pc.setRemoteDescription(new RTCSessionDescription({
        sdp: answerData.sdp,
        type: answerData.type
      }));

      // 8. Connection success!
      this.isConnected = true;
      this.isConnecting = false;
      this.setConnectionState('connected', 'Connected');
      this.orb.setState('idle');
      this.startSessionTimer();
      this.showToast('Connected to Iris Interviewer', 'success');

      // Start DataChannel keepalive ping
      this.keepAliveInterval = setInterval(() => {
        if (this.dc && this.dc.readyState === 'open') {
          this.dc.send('ping');
        }
      }, 1000);

    } catch (err) {
      console.error('Connection failed:', err);
      this.showToast(err.message || 'Connection failed', 'error');
      await this.disconnect();
    }
  }

  async disconnect() {
    this.isConnecting = false;
    this.isConnected = false;

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (this.dc) {
      try { this.dc.close(); } catch (_) {}
      this.dc = null;
    }

    if (this.pc) {
      try { this.pc.close(); } catch (_) {}
      this.pc = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { await this.audioCtx.close(); } catch (_) {}
      this.audioCtx = null;
    }

    this.orb.setMicAnalyser(null);
    this.orb.setBotAnalyser(null);
    this.orb.setState('idle');

    this.setConnectionState('disconnected', 'Disconnected');
    this.showToast('Interview session ended', 'info');
  }

  setupDataChannel(channel) {
    channel.onopen = () => {
      console.log('Data channel open');
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleDataChannelMessage(data);
      } catch (e) {
        // Ping response or raw text
      }
    };

    channel.onclose = () => {
      console.log('Data channel closed');
    };
  }

  /* ==========================================================================
     DATA CHANNEL MESSAGES & REAL-TIME TRANSCRIPTION
     ========================================================================== */

  handleDataChannelMessage(msg) {
    switch (msg.type) {
      // User speech events
      case 'user-started-speaking':
        this.setStageState('Listening to candidate...', 'listening');
        this.orb.setState('listening');
        break;

      case 'user-stopped-speaking':
        this.setStageState('Processing candidate answer...', 'thinking');
        this.orb.setState('thinking');
        break;

      case 'user-interim-transcription':
        this.renderUserInterim(msg.text);
        break;

      case 'user-transcription':
        this.removeUserInterim();
        if (msg.text && msg.text.trim()) {
          this.appendMessage('candidate', msg.text.trim());
        }
        break;

      // Bot speech events
      case 'bot-started-speaking':
        this.setStageState('Iris is speaking...', 'speaking');
        this.orb.setState('speaking');
        break;

      case 'bot-stopped-speaking':
        this.setStageState('Iris is ready for your answer', 'idle');
        this.orb.setState('idle');
        break;

      case 'bot-response-start':
        this.setStageState('Iris is formulating feedback...', 'thinking');
        this.orb.setState('thinking');
        this.startStreamingInterviewerMessage();
        break;

      case 'bot-llm-text':
      case 'bot-tts-text':
        this.appendStreamingInterviewerText(msg.text);
        break;

      case 'bot-response-end':
        this.finalizeStreamingInterviewerMessage();
        break;

      // RAG Retrieval Event
      case 'rag-retrieval':
        this.handleRAGRetrievalEvent(msg);
        break;

      default:
        break;
    }
  }

  renderUserInterim(text) {
    if (!text || !text.trim()) return;
    if (this.emptyTranscript) this.emptyTranscript.style.display = 'none';

    if (!this.interimUserMsgEl) {
      this.interimUserMsgEl = document.createElement('div');
      this.interimUserMsgEl.className = 'transcript-msg candidate interim-preview-bubble';
      this.interimUserMsgEl.innerHTML = `
        <div class="msg-meta">
          <span class="msg-speaker-badge">Candidate (speaking...)</span>
        </div>
        <div class="msg-bubble">${this.escapeHTML(text)}</div>
      `;
      this.transcriptFeed.appendChild(this.interimUserMsgEl);
    } else {
      const bubble = this.interimUserMsgEl.querySelector('.msg-bubble');
      if (bubble) bubble.textContent = text;
    }
    this.scrollTranscriptToBottom();
  }

  removeUserInterim() {
    if (this.interimUserMsgEl) {
      this.interimUserMsgEl.remove();
      this.interimUserMsgEl = null;
    }
  }

  appendMessage(sender, text, ragContext = null) {
    if (this.emptyTranscript) this.emptyTranscript.style.display = 'none';

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const msgObj = { id: Date.now(), sender, text, timestamp, ragContext };
    this.messages.push(msgObj);

    const msgEl = document.createElement('div');
    msgEl.className = `transcript-msg ${sender}`;
    msgEl.dataset.id = msgObj.id;

    const speakerName = sender === 'candidate' ? 'You (Candidate)' : 'Iris (Interviewer)';
    const speakerIcon = sender === 'candidate' ? '🎙️' : '✨';

    let ragTagHtml = '';
    if (ragContext && ragContext.retrieved && ragContext.retrieved.length > 0) {
      ragTagHtml = `<div class="msg-rag-ground-tag">🎯 Grounded on ${ragContext.retrieved.length} Question Bank items</div>`;
    }

    msgEl.innerHTML = `
      <div class="msg-meta">
        <span class="msg-speaker-badge">${speakerIcon} ${speakerName}</span>
        <span class="msg-time">${timestamp}</span>
      </div>
      <div class="msg-bubble">${this.formatMessageText(text)}</div>
      ${ragTagHtml}
    `;

    this.transcriptFeed.appendChild(msgEl);
    this.updateTranscriptCount();
    this.scrollTranscriptToBottom();
  }

  startStreamingInterviewerMessage() {
    if (this.emptyTranscript) this.emptyTranscript.style.display = 'none';

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.activeInterviewerMsgObj = {
      id: Date.now(),
      sender: 'interviewer',
      text: '',
      timestamp
    };

    this.activeInterviewerMsgEl = document.createElement('div');
    this.activeInterviewerMsgEl.className = 'transcript-msg interviewer streaming';
    this.activeInterviewerMsgEl.innerHTML = `
      <div class="msg-meta">
        <span class="msg-speaker-badge">✨ Iris (Interviewer)</span>
        <span class="msg-time">${timestamp}</span>
      </div>
      <div class="msg-bubble"></div>
    `;

    this.transcriptFeed.appendChild(this.activeInterviewerMsgEl);
    this.scrollTranscriptToBottom();
  }

  appendStreamingInterviewerText(chunk) {
    if (!chunk) return;
    if (!this.activeInterviewerMsgEl) {
      this.startStreamingInterviewerMessage();
    }
    this.activeInterviewerMsgObj.text += chunk;
    const bubble = this.activeInterviewerMsgEl.querySelector('.msg-bubble');
    if (bubble) {
      bubble.innerHTML = this.formatMessageText(this.activeInterviewerMsgObj.text);
    }
    this.scrollTranscriptToBottom();
  }

  finalizeStreamingInterviewerMessage() {
    if (this.activeInterviewerMsgEl) {
      this.activeInterviewerMsgEl.classList.remove('streaming');
      if (this.activeInterviewerMsgObj && this.activeInterviewerMsgObj.text.trim()) {
        this.messages.push(this.activeInterviewerMsgObj);
        this.updateTranscriptCount();
      }
      this.activeInterviewerMsgEl = null;
      this.activeInterviewerMsgObj = null;
    }
  }

  handleRAGRetrievalEvent(eventData) {
    this.retrievalCount++;
    this.ragCountBadge.textContent = this.retrievalCount;

    const itemEl = document.createElement('div');
    itemEl.className = 'rag-retrieval-item';
    
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const questionsHtml = (eventData.retrieved || []).map(q => `<li>${this.escapeHTML(q)}</li>`).join('');

    itemEl.innerHTML = `
      <div class="rag-item-header">
        <span class="rag-domain-badge">RAG Match #${this.retrievalCount}</span>
        <span style="font-size: 10px; color: var(--text-muted);">${timeStr}</span>
      </div>
      <div class="rag-item-query">Candidate query: "${this.escapeHTML(eventData.query)}"</div>
      <ul class="rag-matched-list">
        ${questionsHtml}
      </ul>
    `;

    // Insert at the top of the live feed
    if (this.ragLiveFeed.firstChild) {
      this.ragLiveFeed.insertBefore(itemEl, this.ragLiveFeed.firstChild);
    } else {
      this.ragLiveFeed.appendChild(itemEl);
    }
  }

  /* ==========================================================================
     INTERACTIONS & CONTROLS
     ========================================================================== */

  toggleMute() {
    if (!this.localStream) return;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });

    if (this.isMuted) {
      this.btnMute.classList.add('muted');
      this.btnMute.title = 'Unmute Microphone';
      this.btnMute.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      `;
      this.showToast('Microphone muted', 'info');
    } else {
      this.btnMute.classList.remove('muted');
      this.btnMute.title = 'Mute Microphone';
      this.btnMute.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      `;
      this.showToast('Microphone unmuted', 'info');
    }
  }

  interruptAI() {
    if (!this.isConnected || !this.dc) return;
    this.dc.send(JSON.stringify({ type: 'interrupt' }));
    this.orb.setState('listening');
    this.showToast('Interrupted Iris', 'info');
  }

  sendTextMessage() {
    const text = this.chatTextInput.value.trim();
    if (!text) return;
    if (!this.isConnected || !this.dc) {
      this.showToast('Please connect to start chatting', 'error');
      return;
    }

    this.dc.send(JSON.stringify({
      type: 'user-text-message',
      text: text
    }));

    this.appendMessage('candidate', text);
    this.chatTextInput.value = '';
  }

  selectInterviewDomain(roleName) {
    if (this.isConnected && this.dc) {
      const msg = `I would like to practice for a ${roleName} interview.`;
      this.dc.send(JSON.stringify({
        type: 'user-text-message',
        text: msg
      }));
      this.appendMessage('candidate', msg);
    }
    this.showToast(`Selected domain: ${roleName}`, 'info');
  }

  /* ==========================================================================
     QUESTION BANK & RAG INSPECTOR
     ========================================================================== */

  async loadQuestionBank() {
    try {
      const res = await fetch('/api/questions');
      if (!res.ok) return;
      const data = await res.json();
      this.renderQuestionBank(data.domains || {});
    } catch (err) {
      console.warn('Could not load question bank from API:', err);
    }
  }

  renderQuestionBank(domains) {
    this.questionBankTree.innerHTML = '';
    for (const [domainName, questions] of Object.entries(domains)) {
      const groupEl = document.createElement('div');
      groupEl.className = 'domain-group';

      const questionsListHtml = questions.map(q => `<div>• ${this.escapeHTML(q)}</div>`).join('');

      groupEl.innerHTML = `
        <div class="domain-header">
          <span>${this.escapeHTML(domainName)}</span>
          <span class="tab-count-badge">${questions.length} questions</span>
        </div>
        <div class="domain-questions-list" style="display: none;">
          ${questionsListHtml}
        </div>
      `;

      const header = groupEl.querySelector('.domain-header');
      const list = groupEl.querySelector('.domain-questions-list');
      header.addEventListener('click', () => {
        list.style.display = list.style.display === 'none' ? 'flex' : 'none';
      });

      this.questionBankTree.appendChild(groupEl);
    }
  }

  /* ==========================================================================
     AUDIO DEVICES MANAGEMENT
     ========================================================================== */

  async populateAudioDevices() {
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
        this.micSelect.innerHTML = '<option value="">Default Microphone</option>';
        this.speakerSelect.innerHTML = '<option value="">Default Speaker</option>';
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      this.micSelect.innerHTML = '';
      this.speakerSelect.innerHTML = '';

      let micCount = 0;
      let speakerCount = 0;

      devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;

        if (device.kind === 'audioinput') {
          micCount++;
          option.text = device.label || `Microphone ${micCount}`;
          this.micSelect.appendChild(option);
        } else if (device.kind === 'audiooutput') {
          speakerCount++;
          option.text = device.label || `Speaker ${speakerCount}`;
          this.speakerSelect.appendChild(option);
        }
      });

      if (micCount === 0) {
        this.micSelect.innerHTML = '<option value="">Default Microphone</option>';
      }
      if (speakerCount === 0) {
        this.speakerSelect.innerHTML = '<option value="">Default Speaker</option>';
      }
    } catch (err) {
      console.warn('Could not enumerate audio devices:', err);
      this.micSelect.innerHTML = '<option value="">Default Microphone</option>';
      this.speakerSelect.innerHTML = '<option value="">Default Speaker</option>';
    }
  }

  async changeAudioInputDevice() {
    if (!this.isConnected) return;
    this.showToast('Reconnecting with new microphone...', 'info');
    await this.disconnect();
    await this.connect();
  }

  async changeAudioOutputDevice() {
    if (this.remoteAudioEl && typeof this.remoteAudioEl.setSinkId === 'function') {
      try {
        await this.remoteAudioEl.setSinkId(this.speakerSelect.value);
        this.showToast('Speaker updated', 'success');
      } catch (e) {
        console.warn('Cannot setSinkId:', e);
      }
    }
  }

  /* ==========================================================================
     LIVE MINI HUD VISUALIZERS (MIC & IRIS AUDIO WAVES)
     ========================================================================== */

  startMiniVisualizers() {
    const micData = new Uint8Array(64);
    const botData = new Uint8Array(64);

    const draw = () => {
      requestAnimationFrame(draw);

      // 1. Candidate Mic HUD
      if (this.micAnalyser) {
        this.micAnalyser.getByteFrequencyData(micData);
        let sum = 0;
        for (let i = 0; i < 32; i++) sum += micData[i];
        const level = Math.min(100, (sum / (32 * 255)) * 140);
        this.micFill.style.width = `${level}%`;
        this.drawMiniWave(this.micWaveCtx, this.micWaveCanvas, micData, '#34d399');
      } else {
        this.micFill.style.width = '0%';
        this.clearMiniWave(this.micWaveCtx, this.micWaveCanvas);
      }

      // 2. Iris Bot HUD
      if (this.botAnalyser) {
        this.botAnalyser.getByteFrequencyData(botData);
        let sum = 0;
        for (let i = 0; i < 32; i++) sum += botData[i];
        const level = Math.min(100, (sum / (32 * 255)) * 140);
        this.botFill.style.width = `${level}%`;
        this.drawMiniWave(this.botWaveCtx, this.botWaveCanvas, botData, '#38bdf8');
      } else {
        this.botFill.style.width = '0%';
        this.clearMiniWave(this.botWaveCtx, this.botWaveCanvas);
      }
    };

    draw();
  }

  drawMiniWave(ctx, canvas, data, color) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const barWidth = 3;
    const gap = 2;
    const count = Math.floor(w / (barWidth + gap));
    const step = Math.floor(data.length / count) || 1;

    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const val = data[i * step] / 255;
      const barHeight = Math.max(2, val * (h - 2));
      const x = i * (barWidth + gap);
      const y = (h - barHeight) / 2;
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }

  clearMiniWave(ctx, canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /* ==========================================================================
     UI HELPERS & UTILITIES
     ========================================================================== */

  setConnectionState(status, text) {
    this.statusPill.dataset.status = status;
    this.statusText.textContent = text;

    if (status === 'connected') {
      this.btnConnect.dataset.connected = 'true';
      this.btnConnect.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        </svg>
        End Interview
      `;
      this.btnMute.disabled = false;
      this.btnInterrupt.disabled = false;
      this.btnSendText.disabled = false;
    } else {
      this.btnConnect.dataset.connected = 'false';
      this.btnConnect.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
        </svg>
        Start Mock Interview
      `;
      this.btnMute.disabled = true;
      this.btnInterrupt.disabled = true;
      this.setStageState('Ready to begin your mock interview', 'idle');
    }
  }

  setStageState(text, stateType = 'idle') {
    this.stateBadgeText.textContent = text;
    this.stageStateBadge.dataset.state = stateType;
  }

  startSessionTimer() {
    this.sessionStartTime = Date.now();
    this.sessionTimer.textContent = '00:00';
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      const diff = Math.floor((Date.now() - this.sessionStartTime) / 1000);
      const mins = String(Math.floor(diff / 60)).padStart(2, '0');
      const secs = String(diff % 60).padStart(2, '0');
      this.sessionTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  scrollTranscriptToBottom() {
    this.transcriptFeed.scrollTop = this.transcriptFeed.scrollHeight;
  }

  updateTranscriptCount() {
    this.transcriptCountBadge.textContent = this.messages.length;
  }

  filterTranscript(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.transcript-msg').forEach(el => {
      const text = el.querySelector('.msg-bubble')?.textContent?.toLowerCase() || '';
      if (!q || text.includes(q)) {
        el.style.display = 'flex';
      } else {
        el.style.display = 'none';
      }
    });
  }

  copyTranscript() {
    if (this.messages.length === 0) {
      this.showToast('No messages to copy', 'error');
      return;
    }

    const md = this.messages.map(m => `**${m.sender === 'candidate' ? 'Candidate' : 'Iris'}** (${m.timestamp}):\n${m.text}\n`).join('\n');
    navigator.clipboard.writeText(md).then(() => {
      this.showToast('Transcript copied to clipboard', 'success');
    }).catch(() => {
      this.showToast('Failed to copy transcript', 'error');
    });
  }

  exportTranscript() {
    if (this.messages.length === 0) {
      this.showToast('No messages to export', 'error');
      return;
    }

    const exportData = {
      agent: 'Iris Mock Interviewer',
      date: new Date().toISOString(),
      duration: this.sessionTimer.textContent,
      transcript: this.messages
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-transcript-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Transcript exported', 'success');
  }

  clearTranscript() {
    this.messages = [];
    this.transcriptFeed.innerHTML = `
      <div class="empty-transcript-state" id="empty-transcript">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <p>Your conversation transcript will appear here live once the interview starts.</p>
      </div>
    `;
    this.emptyTranscript = document.getElementById('empty-transcript');
    this.updateTranscriptCount();
    this.showToast('Transcript cleared', 'info');
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 200ms ease';
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  formatMessageText(text) {
    if (!text) return '';
    let formatted = this.escapeHTML(text);
    // Bold **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Code blocks `code`
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Newlines to line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
  }

  escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.voiceAgentApp = new VoiceAgentApp();
});
