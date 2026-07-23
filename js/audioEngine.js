class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.activeOscillators = new Map();
        
        // Master routing
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.8;
        
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -10;
        this.compressor.knee.value = 10;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.05;
        this.compressor.release.value = 0.25;

        // Reverb
        this.reverbConvolver = this.ctx.createConvolver();
        this.reverbConvolver.buffer = this.createImpulseResponse(1.5, 1.0);
        
        this.reverbGain = this.ctx.createGain();
        this.reverbGain.gain.value = 0.1;
        
        this.dryGain = this.ctx.createGain();
        this.dryGain.gain.value = 1.0;

        // Output Analyzer
        this.outAnalyser = this.ctx.createAnalyser();
        this.outAnalyser.fftSize = 2048;

        // Output device routing via MediaStreamDestination + <audio> element
        // This enables reliable output device switching via HTMLMediaElement.setSinkId()
        this.mediaStreamDest = this.ctx.createMediaStreamDestination();
        this.audioOutput = new Audio();
        this.audioOutput.srcObject = this.mediaStreamDest.stream;

        // Connections
        this.masterGain.connect(this.dryGain);
        this.masterGain.connect(this.reverbConvolver);
        
        this.reverbConvolver.connect(this.reverbGain);
        
        this.dryGain.connect(this.compressor);
        this.reverbGain.connect(this.compressor);
        
        this.compressor.connect(this.outAnalyser);
        this.outAnalyser.connect(this.mediaStreamDest);
        // Also connect to ctx.destination so the analyser gets data even if audio element isn't playing yet
        this.outAnalyser.connect(this.ctx.destination);

        // Mic Routing
        this.micGain = this.ctx.createGain();
        this.micGain.gain.value = 1.0;
        
        this.micAnalyser = this.ctx.createAnalyser();
        this.micAnalyser.fftSize = 2048;
        
        this.micStream = null;
        this.micSource = null;

        this.micThreshold = -60;
        this.micThresholdEnabled = false;

        this.changeThreshold = 15;
        this.changeThresholdEnabled = false;
        this.prevDataArray = null;
    }

    createImpulseResponse(duration, decay) {
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.ctx.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        for (let i = 0; i < length; i++) {
            const n = i / length;
            const w = Math.pow(1 - n, decay);
            left[i] = (Math.random() * 2 - 1) * w;
            right[i] = (Math.random() * 2 - 1) * w;
        }
        return impulse;
    }

    async enableMic(deviceId = null) {
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        
        // Stop existing stream if we are changing devices
        if (this.micStream && deviceId) {
            this.micStream.getTracks().forEach(track => track.stop());
            if (this.micSource) {
                this.micSource.disconnect();
            }
            this.micSource = null;
        } else if (this.micSource) {
            return true;
        }

        try {
            const constraints = {
                audio: { 
                    echoCancellation: false, 
                    noiseSuppression: false, 
                    autoGainControl: false 
                }
            };
            if (deviceId) {
                constraints.audio.deviceId = { exact: deviceId };
            }
            
            this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.micSource = this.ctx.createMediaStreamSource(this.micStream);
            this.micSource.connect(this.micGain);
            this.micGain.connect(this.micAnalyser);
            return true;
        } catch (err) {
            console.error("Mic access denied", err);
            return false;
        }
    }

    disableMic() {
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
        }
        if (this.micSource) {
            this.micSource.disconnect();
            this.micSource = null;
        }
    }

    setMicGain(val) {
        this.micGain.gain.value = val;
    }

    setMicFftSize(val) {
        this.micAnalyser.fftSize = parseInt(val);
    }

    setMasterVolume(val) {
        this.masterGain.gain.value = val;
    }

    setReverbMix(val) {
        this.reverbGain.gain.value = val;
        this.dryGain.gain.value = 1.0 - (val * 0.5);
    }

    async setOutputDevice(deviceId) {
        // Use HTMLMediaElement.setSinkId() — widely supported for output device selection
        if (typeof this.audioOutput.setSinkId === 'function') {
            try {
                await this.audioOutput.setSinkId(deviceId);
                // When using a specific output device via the audio element,
                // disconnect from ctx.destination to avoid double-output on the default device
                try { this.outAnalyser.disconnect(this.ctx.destination); } catch(e) {}
                // Ensure the audio element is actually playing
                this.ensureAudioOutputPlaying();
            } catch (err) {
                console.error('Error setting output device:', err);
            }
        } else {
            console.warn('setSinkId not supported on this browser');
        }
    }

    ensureAudioOutputPlaying() {
        if (this.audioOutput.paused) {
            this.audioOutput.play().catch(() => {});
        }
    }

    playTone(id, freq, type, vol) {
        if (this.activeOscillators.has(id)) return; // already playing
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.ensureAudioOutputPlaying();

        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();

        osc.type = type;
        osc.frequency.value = freq;

        // ADSR Envelope (Attack)
        const attackTime = 0.05;
        gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + attackTime);

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        osc.start();

        this.activeOscillators.set(id, { osc, gainNode });
    }

    updateTone(id, freq, type, vol) {
        if (!this.activeOscillators.has(id)) return;
        const { osc, gainNode } = this.activeOscillators.get(id);
        osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.02);
        osc.type = type;
        gainNode.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
    }

    stopTone(id) {
        if (!this.activeOscillators.has(id)) return;
        const { osc, gainNode } = this.activeOscillators.get(id);
        
        // ADSR Envelope (Release)
        const releaseTime = 0.1;
        gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        gainNode.gain.setValueAtTime(gainNode.gain.value, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + releaseTime);
        
        osc.stop(this.ctx.currentTime + releaseTime);
        this.activeOscillators.delete(id);
    }

    stopAllTones() {
        for (let id of this.activeOscillators.keys()) {
            this.stopTone(id);
        }
    }

    getMicData() {
        const now = performance.now();
        if (this.lastMicDataTime && now - this.lastMicDataTime < 10) {
            return this.lastMicData;
        }

        const bufferLength = this.micAnalyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        this.micAnalyser.getFloatFrequencyData(dataArray);
        
        // Sanitize -Infinity values
        for (let i = 0; i < bufferLength; i++) {
            if (dataArray[i] === -Infinity) dataArray[i] = -140;
        }

        // Initialize baseline on first call or if FFT size changed
        if (!this.baselineData || this.baselineData.length !== bufferLength) {
            this.baselineData = new Float32Array(bufferLength);
            for (let i = 0; i < bufferLength; i++) {
                this.baselineData[i] = dataArray[i];
            }
        }

        // Exponential moving average baseline with asymmetric time constants
        // Fast downward tracking (noise floor dropped) — alpha = 0.5
        // Slow upward tracking (new steady signal should be learned slowly) — alpha = 0.002
        const ALPHA_DOWN = 0.5;
        const ALPHA_UP = 0.002;

        for (let i = 0; i < bufferLength; i++) {
            const current = dataArray[i];
            const baseline = this.baselineData[i];
            
            if (current < baseline) {
                // Fast downward: quickly follow drops in noise floor
                this.baselineData[i] = baseline + ALPHA_DOWN * (current - baseline);
            } else {
                // Slow upward: gradually adopt new steady-state levels
                this.baselineData[i] = baseline + ALPHA_UP * (current - baseline);
            }
        }

        // Build gated data for display (change threshold applied),
        // but keep raw dataArray intact for peak detection
        let displayArray = dataArray;
        if (this.changeThresholdEnabled) {
            displayArray = new Float32Array(bufferLength);
            for (let i = 0; i < bufferLength; i++) {
                const rise = dataArray[i] - this.baselineData[i];
                if (rise >= this.changeThreshold) {
                    displayArray[i] = dataArray[i];
                } else {
                    displayArray[i] = -200;
                }
            }
        }

        const timeArray = new Float32Array(bufferLength);
        this.micAnalyser.getFloatTimeDomainData(timeArray);

        // Calculate Peak from RAW data (not gated) so readouts always work
        let maxVal = -Infinity;
        let maxIndex = 0;
        for (let i = 0; i < bufferLength; i++) {
            if (dataArray[i] > maxVal) {
                maxVal = dataArray[i];
                maxIndex = i;
            }
        }
        
        const sampleRate = this.ctx.sampleRate;
        let peakFreq = maxIndex * (sampleRate / this.micAnalyser.fftSize);

        if (this.micThresholdEnabled && maxVal < this.micThreshold) {
            peakFreq = 0;
        }

        // RMS
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
            sumSquares += timeArray[i] * timeArray[i];
        }
        const rms = Math.sqrt(sumSquares / bufferLength);

        this.lastMicData = { dataArray: displayArray, rawDataArray: dataArray, timeArray, peakFreq, maxVal, rms };
        this.lastMicDataTime = now;
        
        return this.lastMicData;
    }

    getOutData() {
        const bufferLength = this.outAnalyser.frequencyBinCount;
        const timeArray = new Float32Array(bufferLength);
        this.outAnalyser.getFloatTimeDomainData(timeArray);
        return { timeArray };
    }

    freqToNoteString(freq) {
        if (freq === 0) return "--";
        const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const A4 = 440;
        const C0 = A4 * Math.pow(2, -4.75);
        const h = Math.round(12 * Math.log2(freq / C0));
        if (h < 0) return "--";
        const octave = Math.floor(h / 12);
        const n = h % 12;
        return `${notes[n]}${octave}`;
    }
}
