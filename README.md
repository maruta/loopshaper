# LoopShaper

A web-based loop shaping control design tool for analyzing and designing feedback control systems.

<https://maruta.github.io/loopshaper/>

## Features

- **Interactive Bode Plot**: Visualize gain and phase response of open-loop transfer function L(s) and closed-loop transfer function T(s) with automatic frequency range adjustment
- **Nyquist Plot**: Animated Nyquist diagram with compressed display mapping, pole indentation handling, and playback controls
- **Pole-Zero Map**: Visual representation of L(s) and T(s) poles/zeros with synchronized display of current s-plane point during Nyquist animation
- **Real-time Parameter Tuning**: Adjust controller parameters using sliders with instant plot updates (linear or logarithmic scale)
- **Stability Analysis**: Automatic calculation of gain margin (GM), phase margin (PM), number of open-loop RHP poles (P), and Nyquist winding number (N)
- **URL State Persistence**: Share designs via URL - all settings are compressed with zlib and encoded in the URL hash
- **Flexible Layout**: Dockview-based resizable and rearrangeable panels for desktop, with responsive mobile layout

## Usage

1. Open <https://maruta.github.io/loopshaper/> in a web browser
2. Enter your transfer function definition in the **System Definition** field using math.js syntax
3. Add parameter sliders to interactively tune your controller
4. View the Bode plot, Nyquist plot, pole-zero map, and stability margins in real-time
5. Use the **View** menu to show/hide panels or reset the layout

### Transfer Function Syntax

Define your system using math.js expressions. The variable `s` represents the Laplace variable. The final open-loop transfer function must be assigned to `L`.

Example:

```javascript
K = Kp*(1 + Td*s)
P = 1/(s^2*(s + 1))
L = K * P
```

The tool automatically calculates:

- `T(s) = L(s)/(1+L(s))` - Closed-loop transfer function
- Poles and zeros of both L(s) and T(s)
- Stability based on the Nyquist criterion (Z = N + P)

### Parameters

Add sliders to control parameters in your transfer function:

- **Name**: Variable name used in equations
- **Min/Max**: Slider range
- **Log**: Enable logarithmic scaling for parameters spanning multiple orders of magnitude

### Nyquist Plot Features

- **Compressed Display**: Uses `z → z/(1+|z|/R)` mapping to display infinite curves in a finite area
- **Adjustable Compression**: Mouse wheel adjusts the compression radius R
- **Animation Controls**: Play/pause button and seek bar to trace the Nyquist contour
- **Pole Indentation**: Automatic handling of poles on the imaginary axis with small semicircular detours

## Technologies

- [Shoelace](https://shoelace.style/) - Web component UI library
- [Dockview](https://dockview.dev/) - Flexible panel layout system
- [KaTeX](https://katex.org/) - LaTeX math rendering
- [math.js](https://mathjs.org/) - Mathematical expression parsing and complex number operations
- [pako](https://github.com/nodeca/pako) - zlib compression for URL encoding

## License

MIT License - see [LICENSE](LICENSE) file for details.
