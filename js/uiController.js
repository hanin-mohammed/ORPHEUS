class UIController {
    constructor(app) {
        this.app = app;
        this.engine = app.engine;
        this.visualizer = app.visualizer;
        this.calculator = app.calculator;

        // Footer status elements
        this.elFooterSysState = document.getElementById('footer-sys-state');
        this.elFooterSampleRate = document.getElementById('footer-sample-rate');
        this.elFooterOscCount = document.getElementById('footer-osc-count');

        // Engine control elements
        this.elEngineLed = document.getElementById('engine-led');

        this.elHelpModal = document.getElementById('help-modal');

        // Vertical slider value displays
        this.elMasterVolVal = document.getElementById('master-vol-val');
        this.elMasterReverbVal = document.getElementById('master-reverb-val');

        // KEY 0 elements
        this.elFreqSlider0 = document.getElementById('freq-slider-0');
        this.elFreqDisplay0 = document.getElementById('freq-display-0');
        this.elWave0 = document.getElementById('wave-0');
        this.elVol0 = document.getElementById('vol-0');
        this.elKeySlot0 = document.getElementById('key-slot-0');

        this.keysDown = new Set();
        this.isRunning = false;
        this.micActive = false;

        this.bindEvents();
        this.startUpdateLoop();

        // Populate output devices immediately (labels may be generic until mic permission is granted)
        this.populateOutputDevices();

        // Listen for device changes (e.g. plugging in headphones)
        if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
            navigator.mediaDevices.addEventListener('devicechange', () => {
                this.populateOutputDevices();
                if (this.micActive) {
                    this.populateMicDevices();
                }
                if (this.engine && typeof this.engine.handleDeviceChange === 'function') {
                    this.engine.handleDeviceChange();
                }
            });
        }
    }

    setEngineState(state) {
        // state: 'offline', 'running', 'standby', 'estop'
        this.elEngineLed.classList.remove('active', 'estop');
        this.elFooterSysState.classList.remove('running');

        switch (state) {
            case 'running':
                this.elEngineLed.classList.add('active');
                this.elFooterSysState.innerText = 'RUNNING';
                this.elFooterSysState.classList.add('running');
                break;
            case 'standby':
                this.elFooterSysState.innerText = 'STANDBY';
                break;
            case 'estop':
                this.elEngineLed.classList.add('estop');
                this.elFooterSysState.innerText = 'OFFLINE (ESTOP)';
                break;
            default:
                this.elFooterSysState.innerText = 'OFFLINE';
        }
    }

    bindEvents() {
        // Mic Controls
        document.getElementById('btn-mic-enable').addEventListener('click', async (e) => {
            const btn = document.getElementById('btn-mic-enable');
            if (this.micActive) {
                this.engine.disableMic();
                this.micActive = false;
                btn.innerText = 'ENABLE MIC INPUT';
                btn.classList.add('warning');
                btn.classList.remove('active');
                this.elFooterSampleRate.innerText = '---';
            } else {
                const deviceId = document.getElementById('mic-device').value || null;
                const success = await this.engine.enableMic(deviceId);
                if (success) {
                    this.micActive = true;
                    btn.innerText = 'DISABLE MIC INPUT';
                    btn.classList.remove('warning');
                    btn.classList.add('active');
                    this.elFooterSampleRate.innerText = this.engine.ctx.sampleRate + " Hz";
                    await this.populateMicDevices();
                    // Reset baseline so delta threshold works immediately with real audio,
                    // not stale silence frames from before the mic was active
                    this.engine.resetBaseline();
                    setTimeout(() => this.engine.resetBaseline(), 300);
                }
            }
        });

        document.getElementById('mic-device').addEventListener('change', async (e) => {
            if (this.engine.micSource) {
                await this.engine.enableMic(e.target.value);
            }
        });

        const outDeviceSelect = document.getElementById('out-device');
        if (outDeviceSelect) {
            outDeviceSelect.addEventListener('change', async (e) => {
                await this.engine.setOutputDevice(e.target.value);
            });
        }

        document.getElementById('btn-mic-record').addEventListener('click', (e) => {
            this.visualizer.isRecordingPeaks = !this.visualizer.isRecordingPeaks;
            e.target.innerText = this.visualizer.isRecordingPeaks ? 'STOP' : 'RECORD';
            e.target.classList.toggle('active', this.visualizer.isRecordingPeaks);

            if (!this.visualizer.isRecordingPeaks) {
                this.updatePeaksDisplay();
            } else {
                this.hideTopPeaks();
            }
        });

        document.getElementById('btn-mic-clear').addEventListener('click', (e) => {
            this.visualizer.isRecordingPeaks = false;
            this.visualizer.recordedFftData = null;
            this.visualizer.recordedRawFftData = null;
            const btnRecord = document.getElementById('btn-mic-record');
            if (btnRecord) {
                btnRecord.innerText = 'RECORD';
                btnRecord.classList.remove('active');
            }
            this.visualizer.selectionStartBin = null;
            this.visualizer.selectionEndBin = null;
            this.hideTopPeaks();
            const btnClear = document.getElementById('btn-clear-selection');
            if (btnClear) {
                btnClear.style.opacity = '0.3';
                btnClear.style.pointerEvents = 'none';
            }
        });

        const btnClearSelection = document.getElementById('btn-clear-selection');
        if (btnClearSelection) {
            btnClearSelection.addEventListener('click', () => {
                this.visualizer.selectionStartBin = null;
                this.visualizer.selectionEndBin = null;
                this.updatePeaksDisplay();
            });
        }

        this.visualizer.onSelectionChange = () => {
            this.updatePeaksDisplay();
        };

        document.getElementById('btn-assign-peaks').addEventListener('click', () => {
            if (this.visualizer.recordedFftData && this.engine.micAnalyser) {
                const peaks = this.visualizer.getTopPeaks(this.visualizer.recordedFftData, 3, this.visualizer.recordedRawFftData);
                if (!peaks || peaks.length === 0) return;
                const sampleRate = this.engine.ctx.sampleRate;
                const fftSize = this.engine.micAnalyser.fftSize;

                for (let i = 0; i < Math.min(3, peaks.length); i++) {
                    const freq = peaks[i].index * (sampleRate / fftSize);
                    const input = document.getElementById(`freq-${i + 1}`);
                    if (input) {
                        input.value = freq.toFixed(1);
                        input.dispatchEvent(new Event('input'));
                    }
                }
            }
        });

        document.getElementById('mic-gain').addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (Math.abs(val - 1.0) < 0.1) {
                val = 1.0;
                e.target.value = val;
            }
            this.engine.setMicGain(val);
            const valSpan = document.getElementById('mic-gain-val');
            if (valSpan) valSpan.innerText = val.toFixed(2) + 'x';
        });

        document.getElementById('mic-fft-size').addEventListener('change', (e) => {
            this.engine.setMicFftSize(e.target.value);
        });

        // Threshold Controls
        document.getElementById('mic-thresh').addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (Math.abs(val - (-60)) < 4) {
                val = -60;
                e.target.value = val;
            }
            this.engine.micThreshold = val;
            document.getElementById('mic-thresh-val').innerText = val + ' dB';
        });

        document.getElementById('mic-thresh-enable').addEventListener('change', (e) => {
            this.engine.micThresholdEnabled = e.target.checked;
        });

        // Change Threshold Controls
        document.getElementById('mic-change-thresh').addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (Math.abs(val - 15) < 3) {
                val = 15;
                e.target.value = val;
            }
            this.engine.changeThreshold = val;
            document.getElementById('mic-change-val').innerText = '\u0394 ' + val + ' dB';
            // Reset baseline so the new threshold value takes effect immediately
            if (this.engine.changeThresholdEnabled) {
                this.engine.resetBaseline();
            }
        });

        document.getElementById('mic-change-enable').addEventListener('change', (e) => {
            this.engine.changeThresholdEnabled = e.target.checked;
            // Snapshot current spectrum as new baseline so gating is immediate
            if (e.target.checked) {
                this.engine.resetBaseline();
            }
        });

        // Master Controls with value display
        document.getElementById('master-vol').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.engine.setMasterVolume(val);
            this.elMasterVolVal.innerText = Math.round(val * 100) + '%';
        });
        document.getElementById('master-reverb').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.engine.setReverbMix(val);
            this.elMasterReverbVal.innerText = Math.round(val * 100) + '%';
        });

        // Generator Controls (1-6)
        for (let i = 1; i <= 6; i++) {
            const freqInput = document.getElementById(`freq-${i}`);
            const waveSelect = document.getElementById(`wave-${i}`);
            const volInput = document.getElementById(`vol-${i}`);

            const updateParams = () => {
                if (this.keysDown.has(i.toString())) {
                    this.engine.updateTone(
                        i.toString(), 
                        parseFloat(freqInput.value), 
                        waveSelect.value, 
                        parseFloat(volInput.value)
                    );
                }
            };

            freqInput.addEventListener('input', updateParams);
            waveSelect.addEventListener('change', updateParams);
            volInput.addEventListener('input', updateParams);
        }

        // KEY 0 - Variable frequency slider
        this.elFreqSlider0.addEventListener('input', () => {
            const freq = parseFloat(this.elFreqSlider0.value);
            this.elFreqDisplay0.value = freq.toFixed(1);
            if (this.keysDown.has('0')) {
                this.engine.updateTone('0', freq, this.elWave0.value, parseFloat(this.elVol0.value));
            }
        });

        this.elFreqDisplay0.addEventListener('input', () => {
            let freq = parseFloat(this.elFreqDisplay0.value);
            if (!isNaN(freq)) {
                this.elFreqSlider0.value = freq;
                if (this.keysDown.has('0')) {
                    this.engine.updateTone('0', freq, this.elWave0.value, parseFloat(this.elVol0.value));
                }
            }
        });

        this.elWave0.addEventListener('change', () => {
            if (this.keysDown.has('0')) {
                this.engine.updateTone('0', parseFloat(this.elFreqSlider0.value), this.elWave0.value, parseFloat(this.elVol0.value));
            }
        });

        this.elVol0.addEventListener('input', () => {
            if (this.keysDown.has('0')) {
                this.engine.updateTone('0', parseFloat(this.elFreqSlider0.value), this.elWave0.value, parseFloat(this.elVol0.value));
            }
        });

        // Key 0 Max Toggle
        const maxToggleBtn = document.getElementById('freq-slider-0-max-toggle');
        if (maxToggleBtn) {
            maxToggleBtn.addEventListener('click', () => {
                if (this.elFreqSlider0.max === "2000") {
                    this.elFreqSlider0.max = "5000";
                    maxToggleBtn.innerText = "5 kHz";
                    maxToggleBtn.classList.add('active');
                } else {
                    this.elFreqSlider0.max = "2000";
                    maxToggleBtn.innerText = "2 kHz";
                    maxToggleBtn.classList.remove('active');
                    if (parseFloat(this.elFreqSlider0.value) > 2000) {
                        this.elFreqSlider0.value = 2000;
                        this.elFreqSlider0.dispatchEvent(new Event('input'));
                    }
                }
            });
        }

        // Calculator Controls
        const calcMode = document.getElementById('calc-mode');
        const customMultGroup = document.getElementById('custom-mult-group');
        calcMode.addEventListener('change', (e) => {
            customMultGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
        });

        document.getElementById('btn-calc').addEventListener('click', () => {
            const baseFreq = parseFloat(document.getElementById('base-freq').value);
            const mode = calcMode.value;
            const mult = parseFloat(document.getElementById('custom-mult').value);
            const results = this.calculator.calculate(baseFreq, mode, mult, 6);
            this.renderFreqResults(results);
        });

        document.getElementById('btn-auto-assign').addEventListener('click', () => {
            const baseFreq = parseFloat(document.getElementById('base-freq').value);
            const mode = calcMode.value;
            const mult = parseFloat(document.getElementById('custom-mult').value);
            const results = this.calculator.calculate(baseFreq, mode, mult, 6);
            
            for (let i = 0; i < 6; i++) {
                if (results[i]) {
                    const input = document.getElementById(`freq-${i + 1}`);
                    input.value = results[i];
                    input.dispatchEvent(new Event('input'));
                }
            }
            this.renderFreqResults(results);
        });

        // Experiment Controls
        document.getElementById('btn-start').addEventListener('click', () => {
            if (this.engine.ctx.state === 'suspended') this.engine.ctx.resume();
            this.engine.unmuteOutput();
            this.isRunning = true;
            this.setEngineState('running');
        });
        document.getElementById('btn-stop').addEventListener('click', () => {
            this.isRunning = false;
            this.engine.stopAllTones();
            this.keysDown.clear();
            this.updateKeyUI();
            this.setEngineState('standby');
        });
        document.getElementById('btn-mute-all').addEventListener('click', () => {
            this.engine.stopAllTones();
            this.keysDown.clear();
            this.updateKeyUI();
        });
        document.getElementById('btn-estop').addEventListener('click', () => {
            this.isRunning = false;
            this.engine.stopAllTones();
            this.engine.muteOutputInstantly();
            
            // Delay suspend to allow fade out and prevent audio buffer spasm
            setTimeout(() => {
                if (!this.isRunning) {
                    this.engine.ctx.suspend();
                }
            }, 150);

            this.keysDown.clear();
            this.updateKeyUI();
            this.setEngineState('estop');
        });

        // Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            const key = e.key.toLowerCase();
            
            if (key === 'h') {
                this.elHelpModal.style.display = this.elHelpModal.style.display === 'block' ? 'none' : 'block';
            }
            if (key === 'm') {
                document.getElementById('btn-mic-enable').click();
            }
            if (key === 'v') {
                document.getElementById('btn-mic-record').click();
            }
            if (key === ' ') {
                e.preventDefault();
                document.getElementById('btn-mute-all').click();
            }
            if (key === 'escape') {
                document.getElementById('btn-estop').click();
            }

            // Keys 1-6
            if (['1', '2', '3', '4', '5', '6'].includes(key) && this.isRunning) {
                this.keysDown.add(key);
                const freq = parseFloat(document.getElementById(`freq-${key}`).value);
                const type = document.getElementById(`wave-${key}`).value;
                const vol = parseFloat(document.getElementById(`vol-${key}`).value);
                this.engine.playTone(key, freq, type, vol);
                this.updateKeyUI();
            }

            // Key 0
            if (key === '0' && this.isRunning) {
                this.keysDown.add('0');
                const freq = parseFloat(this.elFreqSlider0.value);
                const type = this.elWave0.value;
                const vol = parseFloat(this.elVol0.value);
                this.engine.playTone('0', freq, type, vol);
                this.updateKeyUI();
            }
        });

        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (['1', '2', '3', '4', '5', '6'].includes(key)) {
                this.keysDown.delete(key);
                this.engine.stopTone(key);
                this.updateKeyUI();
            }
            if (key === '0') {
                this.keysDown.delete('0');
                this.engine.stopTone('0');
                this.updateKeyUI();
            }
        });

        // Play Toggle Buttons
        document.querySelectorAll('.btn-play-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (!this.isRunning) return;
                const key = btn.dataset.key;
                if (this.keysDown.has(key)) {
                    this.keysDown.delete(key);
                    this.engine.stopTone(key);
                } else {
                    this.keysDown.add(key);
                    if (key === '0') {
                        const freq = parseFloat(this.elFreqSlider0.value);
                        const type = this.elWave0.value;
                        const vol = parseFloat(this.elVol0.value);
                        this.engine.playTone('0', freq, type, vol);
                    } else {
                        const freq = parseFloat(document.getElementById(`freq-${key}`).value);
                        const type = document.getElementById(`wave-${key}`).value;
                        const vol = parseFloat(document.getElementById(`vol-${key}`).value);
                        this.engine.playTone(key, freq, type, vol);
                    }
                }
                this.updateKeyUI();
            });
        });

        // Theme Color Picker
        document.getElementById('theme-color').addEventListener('input', (e) => {
            const newColor = e.target.value;
            document.documentElement.style.setProperty('--text-amber', newColor);
            document.documentElement.style.setProperty('--text-active', newColor);
            
            // Update visualizer colors
            this.visualizer.colorAmber = newColor;
            this.visualizer.colorOrange = newColor;
        });

        // Crosshair
        document.addEventListener('mousemove', (e) => {
            const crosshair = document.getElementById('crosshair');
            if (e.target.tagName === 'CANVAS') {
                crosshair.style.display = 'block';
                crosshair.style.left = e.clientX + 'px';
                crosshair.style.top = e.clientY + 'px';
            } else {
                crosshair.style.display = 'none';
            }
        });
    }

    async populateMicDevices() {
        const select = document.getElementById('mic-device');
        const currentVal = select.value;

        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        
        if (audioInputs.length > 0) {
            select.innerHTML = '';
            audioInputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Microphone ${select.length + 1}`;
                select.appendChild(option);
            });
            
            if (currentVal && Array.from(select.options).some(opt => opt.value === currentVal)) {
                select.value = currentVal;
            } else if (this.engine.micStream) {
                const activeTrack = this.engine.micStream.getAudioTracks()[0];
                if (activeTrack) {
                    const activeSettings = activeTrack.getSettings();
                    if (activeSettings.deviceId) {
                        select.value = activeSettings.deviceId;
                    }
                }
            }
        }

        // Also refresh output devices (labels become available after mic permission)
        await this.populateOutputDevices();
    }

    async populateOutputDevices() {
        const outSelect = document.getElementById('out-device');
        if (!outSelect) return;

        const outCurrentVal = outSelect.value;

        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

        if (audioOutputs.length > 0) {
            outSelect.innerHTML = '';
            audioOutputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Speaker ${outSelect.length + 1}`;
                outSelect.appendChild(option);
            });
            
            if (outCurrentVal && Array.from(outSelect.options).some(opt => opt.value === outCurrentVal)) {
                outSelect.value = outCurrentVal;
            } else if (typeof this.engine.ctx.sinkId !== 'undefined' && this.engine.ctx.sinkId !== '') {
                outSelect.value = this.engine.ctx.sinkId;
            }
        }
    }

    renderFreqResults(results) {
        const container = document.getElementById('freq-results');
        container.innerHTML = '';
        results.forEach((freq, index) => {
            const item = document.createElement('div');
            item.className = 'freq-item';
            
            const span = document.createElement('span');
            span.innerText = `${freq} Hz`;

            const assignGroup = document.createElement('div');
            assignGroup.className = 'assign-buttons';
            
            for (let i = 1; i <= 6; i++) {
                const btn = document.createElement('button');
                btn.innerText = `${i}`;
                btn.title = `Assign to Key ${i}`;
                btn.onclick = () => {
                    document.getElementById(`freq-${i}`).value = freq;
                };
                assignGroup.appendChild(btn);
            }

            item.appendChild(span);
            item.appendChild(assignGroup);
            container.appendChild(item);
        });
    }

    displayTopPeaks(peaks) {
        if (peaks && peaks.length > 0 && this.engine.micAnalyser) {
            const sampleRate = this.engine.ctx.sampleRate;
            const fftSize = this.engine.micAnalyser.fftSize;
            
            for (let i = 0; i < 3; i++) {
                const dot = document.getElementById(`peak-dot-${i + 1}`);
                const val = document.getElementById(`peak-val-${i + 1}`);
                
                if (i < peaks.length) {
                    const peak = peaks[i];
                    const freq = peak.index * (sampleRate / fftSize);
                    const color = this.visualizer.peakColors[i % this.visualizer.peakColors.length];
                    
                    if (dot) dot.style.backgroundColor = color;
                    if (val) {
                        val.innerText = `${freq.toFixed(1)} Hz`;
                        val.style.color = color;
                    }
                } else {
                    if (val) {
                        val.innerText = '\u00A0';
                        val.style.color = 'transparent';
                    }
                }
            }
            
            const btnAssign = document.getElementById('btn-assign-peaks');
            if (btnAssign) {
                btnAssign.style.opacity = '1';
                btnAssign.style.pointerEvents = 'auto';
            }
        } else {
            this.hideTopPeaks();
        }
    }

    hideTopPeaks() {
        for (let i = 1; i <= 3; i++) {
            const val = document.getElementById(`peak-val-${i}`);
            if (val) {
                val.innerText = '\u00A0';
                val.style.color = 'transparent';
            }
        }
        
        const btnAssign = document.getElementById('btn-assign-peaks');
        if (btnAssign) {
            btnAssign.style.opacity = '0.3';
            btnAssign.style.pointerEvents = 'none';
        }
    }

    updatePeaksDisplay() {
        // Only use recorded data for peak detection.
        // Live mic data (lastMicFftData) changes every frame, so using it here
        // would show a random snapshot that never updates — leading to erratic behavior.
        const dataToUse = this.visualizer.recordedFftData;
        if (dataToUse && this.engine.micAnalyser) {
            const peaks = this.visualizer.getTopPeaks(dataToUse, 3, this.visualizer.recordedRawFftData);
            this.displayTopPeaks(peaks);
        } else {
            this.hideTopPeaks();
        }

        const btnClear = document.getElementById('btn-clear-selection');
        if (btnClear) {
            if (this.visualizer.selectionStartBin !== null && this.visualizer.selectionEndBin !== null) {
                btnClear.style.opacity = '1';
                btnClear.style.pointerEvents = 'auto';
            } else {
                btnClear.style.opacity = '0.3';
                btnClear.style.pointerEvents = 'none';
            }
        }
    }

    updateKeyUI() {
        for (let i = 1; i <= 6; i++) {
            const slot = document.getElementById(`key-slot-${i}`);
            const btn = slot.querySelector('.btn-play-toggle');
            if (this.keysDown.has(i.toString())) {
                slot.classList.add('active');
                if (btn) btn.innerText = 'STOP';
            } else {
                slot.classList.remove('active');
                if (btn) btn.innerText = 'PLAY';
            }
        }
        const btn0 = this.elKeySlot0.querySelector('.btn-play-toggle');
        if (this.keysDown.has('0')) {
            this.elKeySlot0.classList.add('active');
            if (btn0) btn0.innerText = 'STOP';
        } else {
            this.elKeySlot0.classList.remove('active');
            if (btn0) btn0.innerText = 'PLAY';
        }
        this.elFooterOscCount.innerText = this.engine.activeOscillators.size;
    }

    startUpdateLoop() {
        const loop = (time) => {
            // Mic Readouts Update
            if (this.engine.micSource) {
                const data = this.engine.getMicData();
                document.getElementById('mic-readout-freq').innerText = data.peakFreq.toFixed(1) + ' Hz';
                document.getElementById('mic-readout-note').innerText = this.engine.freqToNoteString(data.peakFreq);
            } else {
                document.getElementById('mic-readout-freq').innerText = '0 Hz';
                document.getElementById('mic-readout-note').innerText = '--';
            }

            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }
}
