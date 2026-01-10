// Bode plot drawing for loop shaping tool

// Format frequency value with appropriate precision
function formatFrequency(freq) {
    if (freq >= 1000) {
        return freq.toPrecision(3);
    } else if (freq >= 100) {
        return freq.toFixed(1);
    } else if (freq >= 10) {
        return freq.toFixed(2);
    } else if (freq >= 1) {
        return freq.toFixed(2);
    } else if (freq >= 0.1) {
        return freq.toFixed(3);
    } else if (freq >= 0.01) {
        return freq.toFixed(4);
    } else {
        return freq.toPrecision(2);
    }
}

// Draw multiple transfer functions on the same Bode plot
// transferFunctions: array of { compiled, gainColor, phaseColor, visible }
function drawBodeMulti(transferFunctions, w, wrapperId, canvasId, options) {
    options = options || {};
    const wrapper = document.getElementById(wrapperId);
    const canvas = document.getElementById(canvasId);

    // During Dockview drag/layout transitions, panels can be temporarily detached.
    // Guard against null elements to avoid exceptions that can freeze the tab.
    if (!wrapper || !canvas) return null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const height = wrapper.clientHeight;
    const width = wrapper.clientWidth;

    // If the panel is hidden/collapsed, avoid resizing/drawing.
    if (!width || !height) return null;

    canvas.height = height * devicePixelRatio;
    canvas.width = width * devicePixelRatio;
    canvas.style.height = height + 'px';
    canvas.style.width = width + 'px';

    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Clear canvas
    ctx.fillStyle = options.backgroundColor || '#ffffff';
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
                    wpc.push(w[i - 1] + ratio * (w[i] - w[i - 1]));
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
    ctx.fillStyle = options.textColor || '#333333';

    // Draw frequency grid
    for (let i = math.ceil(wmin); i <= math.floor(wmax); i++) {
        let x = w2x(i);
        ctx.fillText((math.pow(10, i)).toFixed(Math.max(0, -i)), x, p2y(pmin) + 5);

        // Major grid lines
        ctx.strokeStyle = options.majorGridColor || '#c0c0c0';
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
            ctx.strokeStyle = options.minorGridColor || '#c0c0c0';
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
        wpc.forEach((wc) => {
            let x = w2x(math.log10(wc));
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

    // Axis labels
    ctx.fillStyle = options.textColor || '#333333';
    ctx.fillText("Frequency [rad/s]", (w2x(wmin) + w2x(wmax)) / 2, p2y(pmin) + 25);

    // Gain and phase grid
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

    // Gain grid lines - start from multiple of 20 that includes 0
    let gGridStart = Math.floor(gmin / 20) * 20;
    for (let g = gGridStart; g <= gmax + 1; g += 20) {
        if (g < gmin - 0.1) continue;  // Skip if below visible range
        let y = g2y(g);
        ctx.fillStyle = options.textColor || '#333333';
        ctx.fillText(g.toFixed(0), w2x(wmin) - 5, y);
        if (g === 0) {
            ctx.strokeStyle = '#333333';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
        } else {
            ctx.strokeStyle = options.majorGridColor || '#c0c0c0';
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.moveTo(w2x(wmin), y);
        ctx.lineTo(w2x(wmax), y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Phase grid lines - start from multiple of 45 that includes 0, -180, 180
    let pGridStart = Math.floor(pmin / 45) * 45;
    for (let p = pGridStart; p <= pmax + 1; p += 45) {
        if (p < pmin - 0.1) continue;  // Skip if below visible range
        let y = p2y(p);
        ctx.fillStyle = options.textColor || '#333333';
        ctx.fillText(p.toFixed(0), w2x(wmin) - 5, y);
        // Highlight phase crossover reference lines at -180 + 360k degrees
        // These are critical for stability analysis as they define phase crossover frequencies
        if ((p + 180) % 360 === 0) {
            ctx.strokeStyle = '#333333';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
        } else {
            ctx.strokeStyle = options.majorGridColor || '#c0c0c0';
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.moveTo(w2x(wmin), y);
        ctx.lineTo(w2x(wmax), y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw curves for each transfer function
    transferFunctions.forEach((tf, tfIndex) => {
        let data = allData[tfIndex];
        if (!data) return;

        // Draw gain curve with clipping to plot area
        ctx.save();
        ctx.beginPath();
        ctx.rect(leftMargin, topMargin, plotWidth, plotHeight);
        ctx.clip();
        ctx.strokeStyle = tf.gainColor || '#0088aa';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            let x = w2x(math.log10(w[i]));
            let y = g2y(data.gain[i]);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.restore();

        // Draw phase curve with clipping to plot area
        ctx.save();
        ctx.beginPath();
        ctx.rect(leftMargin, topMargin + plotHeight + midMargin, plotWidth, plotHeight);
        ctx.clip();
        ctx.strokeStyle = tf.phaseColor || '#0088aa';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            let x = w2x(math.log10(w[i]));
            let y = p2y(data.phase[i]);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.restore();
    });

    ctx.restore();

    // Return stability margins (based on first TF data)
    let gainMargins = [];
    let phaseMargins = [];
    let firstData = allData[0];

    if (firstData) {
        // Calculate gain margin at phase crossover
        wpc.forEach((wc) => {
            for (let i = 0; i < N - 1; i++) {
                if (w[i] <= wc && w[i + 1] >= wc) {
                    let ratio = (wc - w[i]) / (w[i + 1] - w[i]);
                    let gainAtWpc = firstData.gain[i] + ratio * (firstData.gain[i + 1] - firstData.gain[i]);
                    let gm = -gainAtWpc;
                    gainMargins.push({ frequency: wc, margin: gm, gainAtCrossover: gainAtWpc });
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
                ctx.font = '12px Consolas, monospace';

                // Draw gain margins
                gainMargins.forEach((gm) => {
                    let x = w2x(math.log10(gm.frequency));
                    let y0dB = g2y(0);
                    let yGain = g2y(gm.gainAtCrossover);
                    let yPhaseRef = p2y(-180);

                    // Vertical line on gain plot (0dB to gain value)
                    ctx.beginPath();
                    ctx.moveTo(x, y0dB);
                    ctx.lineTo(x, yGain);
                    ctx.stroke();

                    // GM label at midpoint
                    let gmValue = Math.round(gm.margin);
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('GM=' + (gmValue >= 0 ? '+' : '') + gmValue + 'dB', x + 4, (y0dB + yGain) / 2);

                    // Crossover marker on phase plot (-180° line)
                    ctx.beginPath();
                    ctx.arc(x, yPhaseRef, 4, 0, 2 * Math.PI);
                    ctx.fill();

                    // Frequency label
                    ctx.textBaseline = 'bottom';
                    ctx.fillText('ω=' + formatFrequency(gm.frequency) + 'rad/s', x + 6, yPhaseRef - 6);
                });

                // Draw phase margins
                phaseMargins.forEach((pm) => {
                    let x = w2x(math.log10(pm.frequency));
                    let yPhase = p2y(pm.phaseAtCrossover);
                    let yRef = p2y(pm.referencePhase);
                    let y0dB = g2y(0);

                    // Vertical line on phase plot (phase value to -180° reference)
                    ctx.beginPath();
                    ctx.moveTo(x, yPhase);
                    ctx.lineTo(x, yRef);
                    ctx.stroke();

                    // PM label at midpoint
                    let pmValue = Math.round(pm.margin);
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('PM=' + pmValue + '°', x + 4, (yPhase + yRef) / 2);

                    // Crossover marker on gain plot (0dB line)
                    ctx.beginPath();
                    ctx.arc(x, y0dB, 4, 0, 2 * Math.PI);
                    ctx.fill();

                    // Frequency label
                    ctx.textBaseline = 'bottom';
                    ctx.fillText('ω=' + formatFrequency(pm.frequency) + 'rad/s', x + 6, y0dB - 6);
                });

                ctx.restore();
            }
        }
    }

    return {
        gainMargins: gainMargins,
        phaseMargins: phaseMargins,
        gainCrossoverFrequencies: wgc,
        phaseCrossoverFrequencies: wpc
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
