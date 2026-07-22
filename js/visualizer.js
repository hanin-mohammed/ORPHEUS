class Visualizer {
    constructor(audioEngine) {
        this.engine = audioEngine;
        this.isRecordingPeaks = false;
        this.recordedFftData = null;
        
        // Canvases
        this.micFftCanvas = document.getElementById('canvas-mic-fft');
        this.micFftCtx = this.micFftCanvas.getContext('2d');
        
        this.micOscCanvas = document.getElementById('canvas-mic-osc');
        this.micOscCtx = this.micOscCanvas.getContext('2d');

        this.outOscCanvas = document.getElementById('canvas-out-osc');
        this.outOscCtx = this.outOscCanvas.getContext('2d');

        // Store last drawn data for hover queries
        this.lastMicFftData = null;
        this.lastMicOscData = null;
        this.lastOutOscData = null;

        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.draw = this.draw.bind(this);
        this.animationId = requestAnimationFrame(this.draw);

        // Styling constants
        this.colorGrid = 'rgba(255, 255, 255, 0.1)';
        this.colorAmber = '#ffb000';
        this.colorOrange = '#ff8a00';
        this.colorAxisText = 'rgba(255, 255, 255, 0.5)';

        // FFT frequency axis marks (Hz)
        this.fftFreqMarks = [200, 500, 1000, 2000, 5000];
        
        // Colors for top peaks
        this.peakColors = ['#ff3366', '#33ccff', '#33ff99'];

        // Setup hover tooltips
        this.setupHoverTooltips();
    }

    resize() {
        const canvases = [this.micFftCanvas, this.micOscCanvas, this.outOscCanvas];
        for (let canvas of canvases) {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
        }
    }

    hexToRgba(hex, alpha) {
        if (hex.startsWith('#')) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        return hex; // fallback
    }

    getTopPeaks(data, count) {
        if (!data) return [];
        let peaks = [];
        const maxDisplayBin = Math.floor(data.length / 8);
        for (let i = 2; i < maxDisplayBin - 2; i++) {
            if (data[i] > data[i-1] && data[i] > data[i+1]) {
                if (!this.engine.micThresholdEnabled || data[i] >= this.engine.micThreshold) {
                    peaks.push({ index: i, value: data[i] });
                }
            }
        }
        peaks.sort((a, b) => b.value - a.value);
        return peaks.slice(0, count);
    }

    drawGrid(ctx, width, height) {
        ctx.strokeStyle = this.colorGrid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x < width; x += 40) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
        for (let y = 0; y < height; y += 40) {
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();
    }

    drawFftAxes(ctx, width, height, bufferLength) {
        const sampleRate = this.engine.ctx.sampleRate;
        const fftSize = this.engine.micAnalyser.fftSize;
        const maxDisplayBin = Math.floor(bufferLength / 8);
        const maxDisplayFreq = maxDisplayBin * (sampleRate / fftSize);

        const xOffset = 32;
        const drawWidth = width - xOffset;

        ctx.font = '9px Funnel Display, sans-serif';
        ctx.fillStyle = this.colorAxisText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // X-axis: frequency labels
        for (const freq of this.fftFreqMarks) {
            if (freq > maxDisplayFreq) continue;
            const bin = freq / (sampleRate / fftSize);
            const x = xOffset + (bin / maxDisplayBin) * drawWidth;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, height - 14);
            ctx.lineTo(x, height);
            ctx.stroke();

            const label = freq >= 1000 ? (freq / 1000) + 'k' : freq.toString();
            ctx.fillText(label, x, height - 13);
        }

        // Y-axis: dB labels
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const dbMarks = [-80, -60, -40, -20, 0];
        for (const db of dbMarks) {
            const normalized = Math.max(0, (db + 100) / 100);
            const y = (height - 16) - (normalized * (height - 16));
            if (y < 5 || y > height - 18) continue;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();

            ctx.fillStyle = '#000000';
            ctx.fillRect(0, y - 6, 28, 12);
            ctx.fillStyle = this.colorAxisText;
            ctx.fillText(db + 'dB', 2, y);
        }
    }

    drawFft(ctx, width, height, dataArray) {
        ctx.clearRect(0, 0, width, height);
        this.drawGrid(ctx, width, height);
        
        let bufferLength = dataArray ? dataArray.length : (this.recordedFftData ? this.recordedFftData.length : 0);
        if (bufferLength === 0) return;

        const displayBins = Math.floor(bufferLength / 8);
        const drawHeight = height - 16;
        
        const xOffset = 32;
        const drawWidth = width - xOffset;
        const sliceWidth = drawWidth / displayBins;

        // Draw threshold line
        if (this.engine.micThresholdEnabled) {
            const normalizedThresh = Math.max(0, (this.engine.micThreshold + 100) / 100);
            const threshY = (height - 16) - (normalizedThresh * drawHeight);
            
            ctx.strokeStyle = 'rgba(255, 176, 0, 0.4)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(xOffset, threshY);
            ctx.lineTo(xOffset + drawWidth, threshY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (dataArray) {
            ctx.beginPath();
            ctx.moveTo(xOffset, height - 16);

            for (let i = 0; i < displayBins; i++) {
                let v = dataArray[i];
                if (this.engine.micThresholdEnabled && v < this.engine.micThreshold) {
                    v = -100;
                }
                const normalized = Math.max(0, (v + 100) / 100);
                const y = (height - 16) - (normalized * drawHeight);
                const x = xOffset + i * sliceWidth;
                ctx.lineTo(x, y);
            }
            
            ctx.lineTo(xOffset + drawWidth, height - 16);
            ctx.lineTo(xOffset, height - 16);
            ctx.fillStyle = this.hexToRgba(this.colorAmber, 0.2);
            ctx.fill();

            ctx.strokeStyle = this.colorAmber;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        if (this.recordedFftData) {
            ctx.beginPath();
            for (let i = 0; i < displayBins; i++) {
                let v = this.recordedFftData[i];
                if (this.engine.micThresholdEnabled && v < this.engine.micThreshold) {
                    v = -100;
                }
                const normalized = Math.max(0, (v + 100) / 100);
                const y = (height - 16) - (normalized * drawHeight);
                const x = xOffset + i * sliceWidth;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            ctx.stroke();

            if (!this.isRecordingPeaks) {
                const peaks = this.getTopPeaks(this.recordedFftData, 3);
                const sampleRate = this.engine.ctx.sampleRate;
                const fftSize = this.engine.micAnalyser.fftSize;
                
                peaks.forEach((peak, i) => {
                    const x = xOffset + (peak.index * sliceWidth);
                    const normalized = Math.max(0, (peak.value + 100) / 100);
                    const y = (height - 16) - (normalized * drawHeight);
                    
                    ctx.fillStyle = this.peakColors[i % this.peakColors.length];
                    ctx.beginPath();
                    ctx.arc(x, y, 4, 0, Math.PI * 2);
                    ctx.fill();
                });
            }
        }

        this.drawFftAxes(ctx, width, height, bufferLength);
    }

    drawOscilloscope(ctx, width, height, timeArray, color) {
        ctx.clearRect(0, 0, width, height);
        this.drawGrid(ctx, width, height);

        if (!timeArray) return;

        const bufferLength = timeArray.length;
        const sliceWidth = width / bufferLength;

        ctx.beginPath();
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const v = timeArray[i];
            const y = (v * 0.5 + 0.5) * height;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            x += sliceWidth;
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    draw() {
        if (this.engine.micSource) {
            const micData = this.engine.getMicData();
            this.lastMicFftData = micData.dataArray ? new Float32Array(micData.dataArray) : null;
            this.lastMicOscData = micData.timeArray ? new Float32Array(micData.timeArray) : null;

            if (this.isRecordingPeaks && micData.dataArray) {
                if (!this.recordedFftData || this.recordedFftData.length !== micData.dataArray.length) {
                    this.recordedFftData = new Float32Array(micData.dataArray);
                } else {
                    for (let i = 0; i < micData.dataArray.length; i++) {
                        this.recordedFftData[i] = Math.max(this.recordedFftData[i], micData.dataArray[i]);
                    }
                }
            }

            this.drawFft(this.micFftCtx, this.micFftCanvas.width, this.micFftCanvas.height, micData.dataArray);
            this.drawOscilloscope(this.micOscCtx, this.micOscCanvas.width, this.micOscCanvas.height, micData.timeArray, this.colorOrange);
        } else {
            this.lastMicFftData = null;
            this.lastMicOscData = null;
            this.drawFft(this.micFftCtx, this.micFftCanvas.width, this.micFftCanvas.height, null);
            this.drawOscilloscope(this.micOscCtx, this.micOscCanvas.width, this.micOscCanvas.height, null, this.colorOrange);
        }

        // Output waveform — ALWAYS updates regardless of pause
        const outData = this.engine.getOutData();
        this.lastOutOscData = outData.timeArray ? new Float32Array(outData.timeArray) : null;
        this.drawOscilloscope(this.outOscCtx, this.outOscCanvas.width, this.outOscCanvas.height, outData.timeArray, this.colorAmber);
        
        this.animationId = requestAnimationFrame(this.draw);
    }

    // --- Hover Tooltip Logic ---
    setupHoverTooltips() {
        const tooltipFft = document.getElementById('tooltip-fft');
        const tooltipOsc = document.getElementById('tooltip-osc');

        this.micFftCanvas.addEventListener('mousemove', (e) => {
            const dataToUse = this.lastMicFftData || this.recordedFftData;
            if (!dataToUse) {
                tooltipFft.style.display = 'none';
                return;
            }
            const rect = this.micFftCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const width = this.micFftCanvas.width;
            const height = this.micFftCanvas.height;

            const bufferLength = dataToUse.length;
            const displayBins = Math.floor(bufferLength / 8);
            const sampleRate = this.engine.ctx.sampleRate;
            const fftSize = this.engine.micAnalyser.fftSize;

            const xOffset = 32;
            const drawWidth = width - xOffset;
            let adjMouseX = mouseX - xOffset;
            if (adjMouseX < 0) adjMouseX = 0;
            if (adjMouseX > drawWidth) adjMouseX = drawWidth;

            const bin = Math.round((adjMouseX / drawWidth) * displayBins);
            if (bin < 0 || bin >= displayBins) {
                tooltipFft.style.display = 'none';
                return;
            }

            const freq = bin * (sampleRate / fftSize);
            const dB = dataToUse[bin];

            tooltipFft.textContent = `${freq.toFixed(1)} Hz  |  ${dB.toFixed(1)} dB`;
            
            let tooltipX = mouseX + 12;
            let tooltipY = (e.clientY - rect.top) - 24;
            if (tooltipX + 150 > width) tooltipX = mouseX - 150;
            if (tooltipY < 0) tooltipY = (e.clientY - rect.top) + 12;
            
            tooltipFft.style.left = tooltipX + 'px';
            tooltipFft.style.top = tooltipY + 'px';
            tooltipFft.style.display = 'block';
        });

        this.micFftCanvas.addEventListener('mouseleave', () => {
            tooltipFft.style.display = 'none';
        });

        this.micOscCanvas.addEventListener('mousemove', (e) => {
            if (!this.lastMicOscData) {
                tooltipOsc.style.display = 'none';
                return;
            }
            const rect = this.micOscCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const width = this.micOscCanvas.width;

            const bufferLength = this.lastMicOscData.length;
            const sampleIndex = Math.round((mouseX / width) * bufferLength);
            if (sampleIndex < 0 || sampleIndex >= bufferLength) {
                tooltipOsc.style.display = 'none';
                return;
            }

            const amplitude = this.lastMicOscData[sampleIndex];
            const sampleRate = this.engine.ctx.sampleRate;
            const timeMs = (sampleIndex / sampleRate) * 1000;

            tooltipOsc.textContent = `${timeMs.toFixed(2)} ms  |  Amp: ${amplitude.toFixed(4)}`;

            let tooltipX = mouseX + 12;
            let tooltipY = (e.clientY - rect.top) - 24;
            if (tooltipX + 160 > width) tooltipX = mouseX - 160;
            if (tooltipY < 0) tooltipY = (e.clientY - rect.top) + 12;

            tooltipOsc.style.left = tooltipX + 'px';
            tooltipOsc.style.top = tooltipY + 'px';
            tooltipOsc.style.display = 'block';
        });

        this.micOscCanvas.addEventListener('mouseleave', () => {
            tooltipOsc.style.display = 'none';
        });
    }
}
