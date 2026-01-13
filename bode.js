// Bode plot drawing for loop shaping tool

// Format frequency value with appropriate precision
function formatFrequency(freq) {
    if (freq >= 1000) return freq.toPrecision(3);
    if (freq >= 100) return freq.toFixed(1);
    if (freq >= 1) return freq.toFixed(2);
    if (freq >= 0.1) return freq.toFixed(3);
    if (freq >= 0.01) return freq.toFixed(4);
    return freq.toPrecision(2);
}

// Draw multiple transfer functions on the same Bode plot
// transferFunctions: array of { compiled, gainColor, phaseColor, visible }
// options.ctx, options.width, options.height can be provided for external context (e.g., SVG export)
function drawBodeMulti(transferFunctions, w, wrapperId, canvasId, options) {
    options = options || {};

    const MARGIN_MARKER_RADIUS = 3;
    const backgroundColor = options.backgroundColor || '#ffffff';
    const textColor = options.textColor || '#333333';
    const majorGridColor = options.majorGridColor || '#c0c0c0';
    const minorGridColor = options.minorGridColor || '#c0c0c0';

    let ctx, width, height;

    // Check if external context is provided (for SVG export)
    if (options.ctx && options.width && options.height) {
        ctx = options.ctx;
        width = options.width;
        height = options.height;
    } else {
        const wrapper = document.getElementById(wrapperId);
        const canvas = document.getElementById(canvasId);

        // During Dockview drag/layout transitions, panels can be temporarily detached.
        // Guard against null elements to avoid exceptions that can freeze the tab.
        if (!wrapper || !canvas) return null;

        ctx = canvas.getContext("2d");
        if (!ctx) return null;

        height = wrapper.clientHeight;
        width = wrapper.clientWidth;

        // If the panel is hidden/collapsed, avoid resizing/drawing.
        if (!width || !height) return null;

        canvas.height = height * devicePixelRatio;
        canvas.width = width * devicePixelRatio;
        canvas.style.height = height + 'px';
        canvas.style.width = width + 'px';

        ctx.scale(devicePixelRatio, devicePixelRatio);
    }

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    let N = w.length;

    // Calculate frequency response for all visible transfer functions
    let allData = [];
    let wgc = [];  // Gain crossover frequencies (for first/primary TF)
    let wpc = [];  // Phase crossover frequencies (for first/primary TF)

    transferFunctions.forEach((tf, tfIndex) => {
        if (!tf.visible) {
            allData.push(null);
            return;
        }

        let gain = Array(N);
        let phase = Array(N);
        let phaseOffset = 0;

        // Calculate gain and phase with phase unwrapping
        for (let i = 0; i < N; i++) {
            let Gjw;
            try {
                Gjw = tf.compiled.evaluate({ 's': math.complex(0, w[i]) });
            } catch (e) {
                Gjw = math.complex(0, 0);
            }
            if (typeof Gjw.abs !== 'function') Gjw = math.complex(Gjw, 0);

            gain[i] = 20 * math.log10(Gjw.abs());

            // Phase unwrapping: adjust offset when phase jumps by more than 180°
            let rawPhase = Gjw.arg() / math.pi * 180;
            if (i > 0 && Math.abs(rawPhase + phaseOffset - phase[i - 1]) > 180) {
                phaseOffset += Math.round(-(rawPhase + phaseOffset - phase[i - 1]) / 360) * 360;
            }
            phase[i] = rawPhase + phaseOffset;
        }

        // For the primary transfer function (L), adjust phase offset so that
        // phase at the lowest gain crossover frequency is close to -180°.
        // This makes phase margin easier to read visually.
        if (tfIndex === 0) {
            let lowestGcIndex = -1;
            for (let i = 1; i < N; i++) {
                if ((gain[i - 1] > 0 && gain[i] <= 0) || (gain[i - 1] <= 0 && gain[i] > 0)) {
                    lowestGcIndex = i;
                    break;
                }
            }

            if (lowestGcIndex > 0) {
                let ratio = -gain[lowestGcIndex - 1] / (gain[lowestGcIndex] - gain[lowestGcIndex - 1]);
                let phaseAtGc = phase[lowestGcIndex - 1] + ratio * (phase[lowestGcIndex] - phase[lowestGcIndex - 1]);
                let n = Math.round((phaseAtGc + 180) / 360);
                let globalOffset = -n * 360;
                for (let i = 0; i < N; i++) {
                    phase[i] += globalOffset;
                }
            }
        }

        // Detect crossover frequencies (only for primary transfer function)
        if (tfIndex === 0) {
            for (let i = 1; i < N; i++) {
                // Gain crossover: where gain crosses 0 dB
                if ((gain[i - 1] > 0 && gain[i] <= 0) || (gain[i - 1] <= 0 && gain[i] > 0)) {
                    let ratio = -gain[i - 1] / (gain[i] - gain[i - 1]);
                    wgc.push(w[i - 1] + ratio * (w[i] - w[i - 1]));
                }

                // Phase crossover: where phase crosses -180° + n*360°
                let p1 = phase[i - 1];
                let p2 = phase[i];
                let n1 = Math.floor((p1 + 180) / 360);
                let n2 = Math.floor((p2 + 180) / 360);
                if (n1 !== n2) {
                    let targetPhase = (p1 > p2) ? n1 * 360 - 180 : n2 * 360 - 180;
                    let ratio = (targetPhase - p1) / (p2 - p1);
                    wpc.push({ freq: w[i - 1] + ratio * (w[i] - w[i - 1]), phase: targetPhase });
                }
            }
        }

        allData.push({ gain, phase });
    });

    // Calculate axis ranges from all visible data
    let gminAll = Infinity, gmaxAll = -Infinity;
    let pminAll = Infinity, pmaxAll = -Infinity;

    allData.forEach(data => {
        if (!data) return;
        gminAll = Math.min(gminAll, Math.min(...data.gain));
        gmaxAll = Math.max(gmaxAll, Math.max(...data.gain));
        pminAll = Math.min(pminAll, Math.min(...data.phase));
        pmaxAll = Math.max(pmaxAll, Math.max(...data.phase));
    });

    // Handle case when no data visible
    if (gminAll === Infinity) {
        gminAll = -60; gmaxAll = 60;
        pminAll = -270; pmaxAll = 0;
    }

    let wmin = math.log10(math.min(w));
    let wmax = math.log10(math.max(w));

    let gmin, gmax, pmin, pmax;

    if (options.autoScaleVertical !== false) {
        // Use continuous values with small margin (5% of range or minimum 5 units)
        // Clamp gain to ±210dB and phase to ±1080°
        let gRange = gmaxAll - gminAll;
        let gMargin = Math.max(5, gRange * 0.05);
        gmin = clip(gminAll - gMargin, -210, 210);
        gmax = clip(gmaxAll + gMargin, -210, 210);

        let pRange = pmaxAll - pminAll;
        let pMargin = Math.max(10, pRange * 0.05);
        pmin = clip(pminAll - pMargin, -1080, 1080);
        pmax = clip(pmaxAll + pMargin, -1080, 1080);

        // When crossover lines are shown, ensure -180° is visible
        if (options.showCrossoverLines !== false) {
            if (pmin > -180) pmin = -180;
            if (pmax < -180) pmax = -180 + pMargin;
        }
    } else {
        // Use custom scale values if provided, otherwise use defaults
        gmin = options.gainMin !== undefined ? options.gainMin : -60;
        gmax = options.gainMax !== undefined ? options.gainMax : 60;
        pmin = options.phaseMin !== undefined ? options.phaseMin : -270;
        pmax = options.phaseMax !== undefined ? options.phaseMax : 90;
    }

    const leftMargin = 70;
    const rightMargin = 20;
    const topMargin = 10;
    const bottomMargin = 60;
    const midMargin = 20;
    const plotWidth = width - leftMargin - rightMargin;
    const plotHeight = (height - topMargin - midMargin - bottomMargin) / 2;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.save();
    let w2x = (w) => (w - wmin) * plotWidth / (wmax - wmin) + leftMargin;
    let g2y = (g) => (g - gmax) * (-plotHeight) / (gmax - gmin) + topMargin;
    let p2y = (p) => (p - pmax) * (-plotHeight) / (pmax - pmin) + topMargin + plotHeight + midMargin;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "14px Consolas, monospace";
    ctx.fillStyle = textColor;

    // Draw frequency grid
    for (let i = math.ceil(wmin); i <= math.floor(wmax); i++) {
        let x = w2x(i);
        ctx.fillText((math.pow(10, i)).toFixed(Math.max(0, -i)), x, p2y(pmin) + 5);

        // Major grid lines
        ctx.strokeStyle = majorGridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, g2y(gmin));
        ctx.lineTo(x, g2y(gmax));
        ctx.moveTo(x, p2y(pmin));
        ctx.lineTo(x, p2y(pmax));
        ctx.stroke();

        // Minor grid lines
        for (let k = 2; k < 10; k++) {
            if (i + math.log10(k) >= wmax) break;
            ctx.strokeStyle = minorGridColor;
            ctx.lineWidth = 0.5;
            let xk = w2x(i + math.log10(k));
            ctx.beginPath();
            ctx.moveTo(xk, g2y(gmin));
            ctx.lineTo(xk, g2y(gmax));
            ctx.moveTo(xk, p2y(pmin));
            ctx.lineTo(xk, p2y(pmax));
            ctx.stroke();
        }
    }

    // Draw gain crossover lines (only for L) - if enabled
    if (options.showCrossoverLines !== false) {
        wgc.forEach((wc) => {
            let x = w2x(math.log10(wc));
            ctx.strokeStyle = '#333333';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(x, g2y(gmax));
            ctx.lineTo(x, p2y(pmin));
            ctx.stroke();
            ctx.setLineDash([]);
        });

        // Draw phase crossover lines (only for L) - blue
        wpc.forEach((pc) => {
            let x = w2x(math.log10(pc.freq));
            ctx.strokeStyle = '#0066cc';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(x, g2y(gmax));
            ctx.lineTo(x, p2y(pmin));
            ctx.stroke();
            ctx.setLineDash([]);
        });
    }

    // Draw pole/zero frequency lines at ω = |p| or |z| (absolute value)
    // Useful for understanding break frequencies in Bode plot
    if (options.showPoleZeroFrequencies && options.poleZeroFrequencies) {
        const pzData = options.poleZeroFrequencies;
        const poleZeroColor = (transferFunctions.length > 0 && transferFunctions[0].gainColor)
            ? transferFunctions[0].gainColor
            : '#0088aa';

        // Collect unique frequencies: ω = |p| = sqrt(re² + im²)
        let pzFrequencies = new Set();

        if (pzData.poles) {
            pzData.poles.forEach(p => {
                let freq = Math.sqrt(p.re * p.re + p.im * p.im);
                if (freq > 1e-6) pzFrequencies.add(freq);
            });
        }

        if (pzData.zeros) {
            pzData.zeros.forEach(z => {
                let freq = Math.sqrt(z.re * z.re + z.im * z.im);
                if (freq > 1e-6) pzFrequencies.add(freq);
            });
        }

        // Draw vertical lines in L(s) color
        ctx.strokeStyle = poleZeroColor;
        ctx.lineWidth = 1;

        pzFrequencies.forEach(freq => {
            let logFreq = math.log10(freq);
            if (logFreq >= wmin && logFreq <= wmax) {
                let x = w2x(logFreq);
                ctx.beginPath();
                ctx.moveTo(x, g2y(gmax));
                ctx.lineTo(x, g2y(gmin));
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x, p2y(pmax));
                ctx.lineTo(x, p2y(pmin));
                ctx.stroke();
            }
        });
    }

    // Axis labels
    ctx.fillStyle = textColor;
    ctx.fillText("Frequency [rad/s]", (w2x(wmin) + w2x(wmax)) / 2, p2y(pmin) + 25);

    // Y-axis labels (rotated)
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.save();
    ctx.translate(w2x(wmin) - 50, (g2y(gmin) + g2y(gmax)) / 2);
    ctx.rotate(-math.pi / 2);
    ctx.fillText("Gain [dB]", 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(w2x(wmin) - 50, (p2y(pmin) + p2y(pmax)) / 2);
    ctx.rotate(-math.pi / 2);
    ctx.fillText("Phase [deg]", 0, 0);
    ctx.restore();

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    // Helper to draw horizontal grid lines with labels
    const drawHorizontalGrid = (min, max, step, yTransform, highlightCondition) => {
        let gridStart = Math.floor(min / step) * step;
        for (let v = gridStart; v <= max + 1; v += step) {
            if (v < min - 0.1) continue;
            let y = yTransform(v);
            ctx.fillStyle = textColor;
            ctx.fillText(v.toFixed(0), w2x(wmin) - 5, y);
            if (highlightCondition(v)) {
                ctx.strokeStyle = '#333333';
                ctx.setLineDash([5, 5]);
            } else {
                ctx.strokeStyle = majorGridColor;
                ctx.setLineDash([]);
            }
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(w2x(wmin), y);
            ctx.lineTo(w2x(wmax), y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    };

    // Gain grid (highlight 0dB), Phase grid (highlight -180° + 360k°)
    drawHorizontalGrid(gmin, gmax, 20, g2y, v => v === 0);
    drawHorizontalGrid(pmin, pmax, 45, p2y, v => (v + 180) % 360 === 0);

    // Draw comparison snapshots (behind main curves, as dashed lines)
    if (typeof savedSnapshots !== 'undefined' && savedSnapshots.length > 0) {
        const drawSnapshotCurve = (snapW, data, color, yTransform, clipY, clipHeight) => {
            if (!data) return;
            const lightColor = typeof lightenColor === 'function' ? lightenColor(color, 0.1) : color;

            ctx.save();
            ctx.beginPath();
            ctx.rect(leftMargin, clipY, plotWidth, clipHeight);
            ctx.clip();
            ctx.strokeStyle = lightColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < snapW.length; i++) {
                const logW = math.log10(snapW[i]);
                if (logW < wmin || logW > wmax) continue;
                const x = w2x(logW);
                const y = yTransform(data[i]);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
            ctx.restore();
        };

        savedSnapshots.forEach((snap) => {
            if (!snap.visible || !snap.bodeData) return;

            const snapW = snap.bodeData.frequencies;
            if (!snapW) return;

            // Define which transfer functions to draw based on displayOptions
            const tfList = [
                { data: snap.bodeData.L, color: CONSTANTS.COLORS.L, show: displayOptions.showL },
                { data: snap.bodeData.T, color: CONSTANTS.COLORS.T, show: displayOptions.showT },
                { data: snap.bodeData.S, color: CONSTANTS.COLORS.S, show: displayOptions.showS }
            ];

            tfList.forEach(({ data, color, show }) => {
                if (!show || !data) return;
                drawSnapshotCurve(snapW, data.gain, color, g2y, topMargin, plotHeight);
                drawSnapshotCurve(snapW, data.phase, color, p2y, topMargin + plotHeight + midMargin, plotHeight);
            });
        });

        ctx.setLineDash([]);
    }

    // Helper to draw a curve with clipping
    const drawCurve = (dataArray, yTransform, clipY, color) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(leftMargin, clipY, plotWidth, plotHeight);
        ctx.clip();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            let x = w2x(math.log10(w[i]));
            let y = yTransform(dataArray[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    };

    // Draw curves for each transfer function
    transferFunctions.forEach((tf, tfIndex) => {
        let data = allData[tfIndex];
        if (!data) return;
        drawCurve(data.gain, g2y, topMargin, tf.gainColor || '#0088aa');
        drawCurve(data.phase, p2y, topMargin + plotHeight + midMargin, tf.phaseColor || '#0088aa');
    });

    ctx.restore();

    // Return stability margins (based on first TF data)
    let gainMargins = [];
    let phaseMargins = [];
    let firstData = allData[0];

    if (firstData) {
        // Calculate gain margin at phase crossover
        wpc.forEach((pc) => {
            for (let i = 0; i < N - 1; i++) {
                if (w[i] <= pc.freq && w[i + 1] >= pc.freq) {
                    let ratio = (pc.freq - w[i]) / (w[i + 1] - w[i]);
                    let gainAtWpc = firstData.gain[i] + ratio * (firstData.gain[i + 1] - firstData.gain[i]);
                    let gm = -gainAtWpc;
                    gainMargins.push({ frequency: pc.freq, margin: gm, gainAtCrossover: gainAtWpc, referencePhase: pc.phase });
                    break;
                }
            }
        });

        // Calculate phase margin at gain crossover
        wgc.forEach((wc) => {
            for (let i = 0; i < N - 1; i++) {
                if (w[i] <= wc && w[i + 1] >= wc) {
                    let ratio = (wc - w[i]) / (w[i + 1] - w[i]);
                    let phase = firstData.phase[i] + ratio * (firstData.phase[i + 1] - firstData.phase[i]);
                    // Normalize phase relative to -180 + n*360 to get correct PM
                    let n = Math.round((phase + 180) / 360);
                    let pm = 180 + phase - n * 360;
                    // Find the reference -180 line for this phase
                    let refPhase = n * 360 - 180;
                    phaseMargins.push({ frequency: wc, margin: pm, phaseAtCrossover: phase, referencePhase: refPhase });
                    break;
                }
            }
        });

        // Draw stability margin annotations if enabled and system is stable
        if (options.showMarginLines !== false) {
            let isStable = gainMargins.every(gm => gm.margin > 0) && phaseMargins.every(pm => pm.margin > 0);

            if (isStable) {
                ctx.save();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#000000';
                ctx.fillStyle = '#000000';
                ctx.font = '14px Consolas, monospace';

                // Draw margin annotation: vertical line with label, crossover marker, and frequency
                const drawMarginAnnotation = (x, y1, y2, label, markerY, freq, labelAlign = 'left') => {
                    // Vertical margin line
                    ctx.beginPath();
                    ctx.moveTo(x, y1);
                    ctx.lineTo(x, y2);
                    ctx.stroke();
                    // Margin label (GM=.../PM=...)
                    ctx.textAlign = labelAlign;
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, x + (labelAlign === 'left' ? 4 : -4), (y1 + y2) / 2);
                    // Crossover marker
                    ctx.beginPath();
                    ctx.arc(x, markerY, MARGIN_MARKER_RADIUS, 0, 2 * Math.PI);
                    ctx.fill();
                    // Frequency label with tight spacing
                    ctx.textBaseline = 'bottom';
                    ctx.textAlign = 'left';
                    const freqText = formatFrequency(freq);
                    const freqWidth = ctx.measureText(freqText).width;
                    ctx.fillText(freqText, x + 6, markerY - 6);
                    ctx.fillText('rad/s', x + 6 + freqWidth + 2, markerY - 6);
                };

                // Draw gain margins (label on right, marker at phase crossover)
                gainMargins.forEach((gm) => {
                    let x = w2x(math.log10(gm.frequency));
                    let gmValue = Math.round(gm.margin);
                    drawMarginAnnotation(x, g2y(0), g2y(gm.gainAtCrossover),
                        'GM=' + (gmValue >= 0 ? '+' : '') + gmValue + 'dB', p2y(gm.referencePhase), gm.frequency);
                });

                // Draw phase margins (label on left, marker at gain crossover)
                phaseMargins.forEach((pm) => {
                    let x = w2x(math.log10(pm.frequency));
                    let pmValue = Math.round(pm.margin);
                    drawMarginAnnotation(x, p2y(pm.phaseAtCrossover), p2y(pm.referencePhase),
                        'PM=' + pmValue + '°', g2y(0), pm.frequency, 'right');
                });

                ctx.restore();
            }
        }
    }

    return {
        gainMargins: gainMargins,
        phaseMargins: phaseMargins,
        gainCrossoverFrequencies: wgc,
        phaseCrossoverFrequencies: wpc.map(pc => pc.freq)
    };
}

// Legacy function for backward compatibility
function drawBode(G, w, wrapperId, canvasId, options) {
    return drawBodeMulti([{
        compiled: G,
        gainColor: '#0088aa',
        phaseColor: '#0088aa',
        visible: true
    }], w, wrapperId, canvasId, options);
}
