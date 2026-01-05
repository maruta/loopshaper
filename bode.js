// Bode plot drawing for loop shaping tool

// Draw multiple transfer functions on the same Bode plot
// transferFunctions: array of { compiled, gainColor, phaseColor, visible }
function drawBodeMulti(transferFunctions, w, wrapperId, canvasId, options) {
    options = options || {};
    let wrapper = document.getElementById(wrapperId);
    let canvas = document.getElementById(canvasId);
    let ctx = canvas.getContext("2d");

    const height = wrapper.clientHeight;
    const width = wrapper.clientWidth;

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
        let phase_offset = 0;

        for (let i = 0; i < N; i++) {
            let omega = w[i];
            let Gjw;
            try {
                Gjw = tf.compiled.evaluate({ 's': math.complex(0, omega) });
            } catch (e) {
                Gjw = math.complex(0, 0);
            }
            if (typeof Gjw.abs !== 'function') Gjw = math.complex(Gjw, 0);
            gain[i] = 20 * math.log10(Gjw.abs());

            // Unwrap phase
            if (i > 0 && Math.abs(Gjw.arg() / math.pi * 180 + phase_offset - phase[i - 1]) > 180) {
                phase_offset += Math.round(-(Gjw.arg() / math.pi * 180 + phase_offset - phase[i - 1]) / 360) * 360;
            }
            phase[i] = Gjw.arg() / math.pi * 180 + phase_offset;

            // Detect crossings only for first transfer function (L)
            if (tfIndex === 0 && i > 0) {
                // Detect gain crossover (both directions)
                if ((gain[i - 1] > 0 && gain[i] <= 0) || (gain[i - 1] <= 0 && gain[i] > 0)) {
                    // Linear interpolation to find exact crossing frequency
                    let ratio = -gain[i - 1] / (gain[i] - gain[i - 1]);
                    let wc = w[i - 1] + ratio * (w[i] - w[i - 1]);
                    wgc.push(wc);
                }

                // Detect phase crossover (-180 + n*360 degrees)
                // Normalize phases to find crossings at -180, -540, -900, etc.
                let p1 = phase[i - 1];
                let p2 = phase[i];
                // Check if phase crosses -180 + n*360 for any integer n
                let n1 = Math.floor((p1 + 180) / 360);
                let n2 = Math.floor((p2 + 180) / 360);
                if (n1 !== n2) {
                    // Crossing occurred - find the target phase value
                    let targetPhase = (p1 > p2) ? n1 * 360 - 180 : n2 * 360 - 180;
                    let ratio = (targetPhase - p1) / (p2 - p1);
                    let wc = w[i - 1] + ratio * (w[i] - w[i - 1]);
                    wpc.push(wc);
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

    // Use continuous values with small margin (5% of range or minimum 5 units)
    // Clamp gain to ±80dB and phase to ±1080°
    let gRange = gmaxAll - gminAll;
    let gMargin = Math.max(5, gRange * 0.05);
    let gmin = clip(gminAll - gMargin, -210, 210);
    let gmax = clip(gmaxAll + gMargin, -210, 210);

    let pRange = pmaxAll - pminAll;
    let pMargin = Math.max(10, pRange * 0.05);
    let pmin = clip(pminAll - pMargin, -1080, 1080);
    let pmax = clip(pmaxAll + pMargin, -1080, 1080);

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
        ctx.strokeStyle = options.majorGridColor || '#cccccc';
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
            ctx.strokeStyle = options.minorGridColor || '#e0e0e0';
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

    // Draw gain crossover lines (only for L) - red
    wgc.forEach((wc) => {
        let x = w2x(math.log10(wc));
        ctx.strokeStyle = '#cc0000';
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
            ctx.strokeStyle = '#cc0000';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
        } else {
            ctx.strokeStyle = options.majorGridColor || '#cccccc';
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
        if (p === -180 || p === 180) {
            ctx.strokeStyle = '#cc0000';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
        } else {
            ctx.strokeStyle = options.majorGridColor || '#cccccc';
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

        // Draw gain curve
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

        // Draw phase curve
        ctx.strokeStyle = tf.phaseColor || '#0088aa';
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
                    let gm = -(firstData.gain[i] + ratio * (firstData.gain[i + 1] - firstData.gain[i]));
                    gainMargins.push({ frequency: wc, margin: gm });
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
                    phaseMargins.push({ frequency: wc, margin: pm });
                    break;
                }
            }
        });
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
