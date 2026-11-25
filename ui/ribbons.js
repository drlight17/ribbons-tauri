/*global document, window, console, Ribbons*/
/**
 * Ribbons Class File.
 * Creates low-poly ribbons background effect inside a target container.
 *
 * Background is painted on a dedicated canvas (same approach as RibbonsModern).
 * backgroundMode: "dark" | "light" | "darkGradient" | "lightGradient" | "transparent"
 */
const Ribbons = (function (name, factory) {
    "use strict";
    const result = factory();
    if (typeof window === "object") {
        window[name] = result;
    }
    return result;
})("Ribbons", function () {
    
    "use strict";
    
    var _w = window,
        _b = document.body,
        _d = document.documentElement;
    // Deterministic PRNG for multi-window stretched scenes.
    var currentRandom = Math.random;
    var mulberry32 = function (seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };
    // random helper
    var random = function () {
        if (arguments.length === 1) { // only 1 argument
            
            if (Array.isArray(arguments[0])) { // extract index from array
                var index = Math.round(random(0, arguments[0].length - 1));
                return arguments[0][index];
            }
            return random(0, arguments[0]); // assume numeric
            
        } else if (arguments.length === 2) { // two arguments range
            return currentRandom() * (arguments[1] - arguments[0]) + arguments[0];
        }
        return 0; // default
    };
    // screen helper
    var screenInfo = function (e) {
        var width = Math.max(0, _w.innerWidth || _d.clientWidth || _b.clientWidth || 0),
            height = Math.max(0, _w.innerHeight || _d.clientHeight || _b.clientHeight || 0),
            scrollx = Math.max(0, _w.pageXOffset || _d.scrollLeft || _b.scrollLeft || 0) - (_d.clientLeft || 0),
            scrolly = Math.max(0, _w.pageYOffset || _d.scrollTop || _b.scrollTop || 0) - (_d.clientTop || 0);
        
        return {
            width: width,
            height: height,
            ratio: width / height,
            centerx: width / 2,
            centery: height / 2,
            scrollx: scrollx,
            scrolly: scrolly
        };
    };
    // mouse/input helper
    var mouseInfo = function (e) {
        var screen = screenInfo(e),
            mousex = e ? Math.max(0, e.pageX || e.clientX || 0) : 0,
            mousey = e ? Math.max(0, e.pageY || e.clientY || 0) : 0;
        return {
            mousex: mousex,
            mousey: mousey,
            centerx: mousex - (screen.width / 2),
            centery: mousey - (screen.height / 2)
        };
    };
    // point object
    var Point = function (x, y) {
        this.x = 0;
        this.y = 0;
        this.set(x, y);
    };
    Point.prototype = {
        constructor: Point,
        set: function (x, y) {
            this.x = (x || 0);
            this.y = (y || 0);
        },
        copy: function (point) {
            this.x = (point.x || 0);
            this.y = (point.y || 0);
            return this;
        },
        multiply: function (x, y) {
            this.x *= (x || 1);
            this.y *= (y || 1);
            return this;
        },
        divide: function (x, y) {
            this.x /= (x || 1);
            this.y /= (y || 1);
            return this;
        },
        add: function (x, y) {
            this.x += (x || 0);
            this.y += (y || 0);
            return this;
        },
        subtract: function (x, y) {
            this.x -= (x || 0);
            this.y -= (y || 0);
            return this;
        },
        clampX: function (min, max) {
            this.x = Math.max(min, Math.min(this.x, max));
            return this;
        },
        clampY: function (min, max) {
            this.y = Math.max(min, Math.min(this.y, max));
            return this;
        },
        flipX: function () {
            this.x *= -1;
            return this;
        },
        flipY: function () {
            this.y *= -1;
            return this;
        }
    };
    // class constructor
    var Factory = function (options) {
        this._canvas = null;
        this._context = null;
        this._bgCanvas = null;
        this._bgContext = null;
        this._sto = null;
        this._width = 0;
        this._height = 0;
        this._stretch = false;
        this._sceneWidth = 0;
        this._sceneHeight = 0;
        this._offsetX = 0;
        this._offsetY = 0;
        this._epochMs = 0;
        this._seed = 0;
        this._frame = 0;
        this._rng = null;
        this._scroll = 0;
        this._ribbons = [];
        this._saved_color_index = 0;
        this._options = {
            // ribbon color HSL saturation amount
            colorSaturation: "80%",
            // ribbon color HSL brightness amount
            colorBrightness: "60%",
            // ribbon color opacity amount
            colorAlpha: 0.65,
            // how fast to cycle through colors in the HSL color space
            colorCycleSpeed: 6,
            // where to start from on the Y axis on each side (top|min, middle|center, bottom|max, random)
            verticalPosition: "center",
            // how fast to get to the other side of the screen
            horizontalSpeed: 150,
            delay: 4, //set delay
            phase: 0.014, //set phase
            // how many ribbons to keep on screen at any given time
            ribbonCount: 3,
            // add stroke along with ribbon fill colors
            strokeSize: 0,
            // move ribbons vertically by a factor on page scroll
            parallaxAmount: -0.5,
            // add animation effect to each ribbon section over time
            animateSections: true,
            // add blur shadow effect to each ribbon with radius
            glow: 10,
            // single color default is off (random ribbons colors)
            singleColor: false,
            /**
             * Background backgroundMode — painted on dedicated bg canvas (same as RibbonsModern).
             *   "dark"          — solid black
             *   "light"         — solid white
             *   "darkGradient"  — radial dark blue gradient
             *   "lightGradient" — radial light gray gradient
             *   "transparent"   — no fill (for glasstron / acrylic blur)
             *
             */
            backgroundMode: "dark"
        };
        this._onDraw = this._onDraw.bind(this);
        this._onResize = this._onResize.bind(this);
        this._onScroll = this._onScroll.bind(this);
        this._destroyed = false;
        this.setOptions(options);
        this.init();
    };
    // class prototype
    Factory.prototype = {
        constructor: Factory,
        // Set and merge local options
        setOptions: function (options) {
            
            var key;
            
            if (typeof options === "object") {
                for (key in options) {
                    if (Object.prototype.hasOwnProperty.call(options, key)) {
                        this._options[key] = options[key];
                    }
                }
            }
            // horizontalSpeed: tray strings or modern-style multiplier (0.3–3)
            // Classic engine uses pixel step (~150). Map small multipliers up.
            var SPEED_MAP = { slow: 80, normal: 150, fast: 220, v_fast: 300 };
            var hs = this._options.horizontalSpeed;
            if (typeof hs === "string" && SPEED_MAP[hs] != null) {
                this._options.horizontalSpeed = SPEED_MAP[hs];
            } else {
                hs = Number(hs);
                if (Number.isFinite(hs) && hs > 0 && hs <= 10) {
                    // multiplier from settings slider → pixel speed
                    this._options.horizontalSpeed = Math.round(hs * 100);
                } else if (!Number.isFinite(hs) || hs <= 0) {
                    this._options.horizontalSpeed = 150;
                }
            }
            // delay / phase: if missing, derive from approximate speed
            var px = Number(this._options.horizontalSpeed) || 150;
            var mult = Math.max(0.3, Math.min(3, px / 100));
            var t = (mult - 0.3) / (3 - 0.3);
            if (this._options.delay == null) this._options.delay = 6.5 - t * 5;
            if (this._options.phase == null) this._options.phase = 0.005 + t * 0.065;

            this._stretch = !!this._options.stretched;
            this._offsetX = Number(this._options.offsetX) || 0;
            this._offsetY = Number(this._options.offsetY) || 0;
            this._epochMs = Number(this._options.epochMs) || 0;
            this._seed = Number(this._options.seed) || 0;
            if (this._stretch) {
                if (Number(this._options.sceneWidth) > 0) {
                    this._sceneWidth = Number(this._options.sceneWidth);
                }
                if (Number(this._options.sceneHeight) > 0) {
                    this._sceneHeight = Number(this._options.sceneHeight);
                }
            }
        },
        _styleLayer: function (el, zIndex) {
            el.style.display = "block";
            el.style.position = "fixed";
            el.style.margin = "0";
            el.style.padding = "0";
            el.style.border = "0";
            el.style.outline = "0";
            el.style.left = "0";
            el.style.top = "0";
            el.style.width = "100%";
            el.style.height = "100%";
            el.style.zIndex = String(zIndex);
            el.style.pointerEvents = "none";
            el.style.background = "transparent";
        },
        /**
         * Background on its own canvas (z-index -2).
         * Ribbons canvas stays transparent at z-index 0 so
         * .datetime-container (z-index: -1) sits between them;
         * .datetime-container.front (z-index: 4) goes above ribbons.
         */
        _drawBackground: function () {
            var ctx = this._bgContext;
            if (!ctx) return;
            var vw = this._width;
            var vh = this._height;
            var mode = this._options.backgroundMode || "dark";

            ctx.clearRect(0, 0, vw, vh);

            // Transparent — leave canvas fully clear for glasstron / acrylic blur
            if (mode === "transparent" || mode === "glass" ) {
                return;
            }

            var W = Math.max(1, this._sceneWidth || vw);
            var H = Math.max(1, this._sceneHeight || vh);
            var ox = this._stretch ? this._offsetX : 0;
            var oy = this._stretch ? this._offsetY : 0;
            var cx = W * 0.5 - ox;
            var cy = H * 0.48 - oy;

            if (mode === "light") {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, vw, vh);
            } else if (mode === "lightGradient") {
                var bgL = ctx.createRadialGradient(
                    W * 0.5 - ox, H * 0.42 - oy, 0,
                    cx, cy, Math.max(W, H) * 0.78
                );
                bgL.addColorStop(0, "#e9edf4");
                bgL.addColorStop(0.48, "#c6cfde");
                bgL.addColorStop(1, "#8998b0");
                ctx.fillStyle = bgL;
                ctx.fillRect(0, 0, vw, vh);
            } else if (mode === "darkGradient") {
                var bg = ctx.createRadialGradient(
                    cx, cy, 0,
                    cx, cy, Math.max(W, H) * 0.75
                );
                bg.addColorStop(0, "#111b39");
                bg.addColorStop(0.55, "#080d1c");
                bg.addColorStop(1, "#03050c");
                ctx.fillStyle = bg;
                ctx.fillRect(0, 0, vw, vh);
            } else {
                // "dark" and any unknown value
                ctx.fillStyle = "#000000";
                ctx.fillRect(0, 0, vw, vh);
            }
        },
        // Initialize the ribbons effect
        init: function () {
            try {
                var seed = this._stretch
                    ? this._seed
                    : (Math.random() * 0x7fffffff) | 0;
                this._rng = mulberry32(seed);
                currentRandom = this._rng;
                this._frame = 0;
                // bg below datetime (-1); ribbons above datetime
                this._bgCanvas = document.createElement("canvas");
                this._bgCanvas.className = "ribbons-bg-canvas";
                this._styleLayer(this._bgCanvas, -2);
                this._canvas = document.createElement("canvas");
                this._canvas.className = "ribbons-canvas";
                this._styleLayer(this._canvas, 0);
                this._onResize();
                this._bgContext = this._bgCanvas.getContext("2d");
                this._context = this._canvas.getContext("2d");
                this._context.globalAlpha = this._options.colorAlpha;
                this._drawBackground();
                window.addEventListener("resize", this._onResize);
                window.addEventListener("scroll", this._onScroll);
                document.body.appendChild(this._bgCanvas);
                document.body.appendChild(this._canvas);
            } catch (e) {
                console.warn("Canvas Context Error: " + e.toString());
                return;
            }
            this._onDraw();
        },
        // Create a new random ribbon and to the list
        addRibbon: function() {
            // tricolor
            if (this._options.singleColor === 667 ) {
                this._options.ribbonCount = 3;
            }
            var sceneW = Math.max(1, this._sceneWidth || this._width);
            var sceneH = Math.max(1, this._sceneHeight || this._height);
            // movement data
            var dir = (Math.round(random(1, 9)) > 5) ? "right" : "left",
                stop = 1000,
                hide = 400,
                min = 0 - hide,
                max = sceneW + hide,
                movex = 0,
                movey = 0,
                startx = (dir === "right") ? min : max,
                starty = Math.round(random(0, sceneH));
            // asjust starty based on options
            if (/^(top|min)$/i.test(this._options.verticalPosition)) {
                starty = 0 + hide;
            } else if (/^(middle|center)$/i.test(this._options.verticalPosition)) {
                starty = (sceneH / 2);
            } else if (/^(bottom|max)$/i.test(this._options.verticalPosition)) {
                starty = sceneH - hide;
            }
            // ribbon sections data
            // tricolor
            if (this._options.singleColor === 667 ) {
                var hues = [667, 240, 360];
                if (this._saved_color_index >= hues.length) {
                    this._saved_color_index = 0;
                }
                var color = hues[this._saved_color_index]
            } else if (this._options.singleColor) {
                var color = this._options.singleColor
            } else {
                var color = Math.round(random(0, 360));
            }
            var ribbon = [],
                point1 = new Point(startx, starty),
                point2 = new Point(startx, starty),
                point3 = null,
                // randomize delay between each ribbon appearance
                delay = currentRandom() * 4;
            // buils ribbon sections
            while (true) {
                if (stop <= 0) break;
                stop--;
                movex = Math.round((currentRandom() * 1 - 0.2) * this._options.horizontalSpeed);
                movey = Math.round((currentRandom() * 1 - 0.5) * (sceneH * 0.35));
                point3 = new Point();
                point3.copy(point2);
                if (dir === "right") {
                    point3.add(movex, movey);
                    if (point2.x >= max) break;
                } else if (dir === "left") {
                    point3.subtract(movex, movey);
                    if (point2.x <= min) break;
                }
                ribbon.push({ // single ribbon section
                    point1: new Point(point1.x, point1.y),
                    point2: new Point(point2.x, point2.y),
                    point3: point3,
                    color: color,
                    delay: delay,
                    dir: dir,
                    alpha: 0,
                    phase: 0,
                });
                point1.copy(point2);
                point2.copy(point3);
                delay += this._options.delay;
                color += this._options.colorCycleSpeed;
                
            }
            // tricolor
            if (this._options.singleColor === 667 ) {
                this._saved_color_index++;
            }
            this._ribbons.push(ribbon);
        },
        _updateSection: function (section) {
            if (!section) return true;
            if (section.phase >= 1 && section.alpha <= 0) {
                return true; // done
            }
            if (section.delay <= 0) {
                section.phase += this._options.phase;
                section.alpha = Math.sin(section.phase) * 1;
                section.alpha = (section.alpha <= 0) ? 0 : section.alpha;
                section.alpha = (section.alpha >= 1) ? 1 : section.alpha;
                if (this._options.animateSections) {
                    var mod = (Math.sin(1 + section.phase * Math.PI / 2) * 0.1);
                    if (section.dir === "right") {
                        section.point1.add(mod, 0);
                        section.point2.add(mod, 0);
                        section.point3.add(mod, 0);
                    } else {
                        section.point1.subtract(mod, 0);
                        section.point2.subtract(mod, 0);
                        section.point3.subtract(mod, 0);
                    }
                    section.point1.add(0, mod);
                    section.point2.add(0, mod);
                    section.point3.add(0, mod);
                }
            } else {
                // affects ribbon dissapear speed
                section.delay -= 0.5;
            }
            return false; // not done yet
        },
        _drawSection: function (section) {
            if (!section || section.alpha <= 0) return;
            var s;
            var l;
            if (section.color === 667) {
                s = "0%";
                l = "100%";
            } else {
                s = this._options.colorSaturation;
                l = this._options.colorBrightness;
            }
            var c = "hsla(" + section.color + ", " + s + ", " + l + ", " + section.alpha + " )";
            this._context.save();
            if (this._options.parallaxAmount !== 0) {
                this._context.translate(0, this._scroll * this._options.parallaxAmount);
            }
            this._context.beginPath();
            var ox = this._stretch ? this._offsetX : 0;
            var oy = this._stretch ? this._offsetY : 0;
            this._context.moveTo(section.point1.x - ox, section.point1.y - oy);
            this._context.lineTo(section.point2.x - ox, section.point2.y - oy);
            this._context.lineTo(section.point3.x - ox, section.point3.y - oy);
            // set blur
            this._context.shadowBlur = this._options.glow;
            this._context.shadowColor = c;
            this._context.fillStyle = c;
            this._context.fill();
            if (this._options.strokeSize > 0) {
                this._context.lineWidth = this._options.strokeSize;
                this._context.strokeStyle = c;
                this._context.lineCap = "round";
                this._context.stroke();
            }
            this._context.restore();
        },
        _targetFrame: function () {
            if (!this._epochMs) return this._frame;
            return Math.max(0, Math.floor((Date.now() - this._epochMs) / (1000 / 60)));
        },
        _step: function () {
            var i;
            for (i = 0; i < this._ribbons.length; ++i) {
                if (!this._ribbons[i]) {
                    this._ribbons.splice(i, 1);
                    i--;
                }
            }
            for (var a = 0; a < this._ribbons.length; ++a) {
                var ribbon = this._ribbons[a];
                if (!ribbon || !Array.isArray(ribbon) || ribbon.length === 0) {
                    this._ribbons[a] = null;
                    continue;
                }
                var numSections = ribbon.length;
                var numDone = 0;
                for (var b = 0; b < numSections; ++b) {
                    if (this._updateSection(ribbon[b])) {
                        numDone++;
                    }
                }
                if (numDone >= numSections) {
                    this._ribbons[a] = null;
                }
            }
            for (i = this._ribbons.length - 1; i >= 0; --i) {
                if (!this._ribbons[i]) {
                    this._ribbons.splice(i, 1);
                }
            }
            while (this._ribbons.length < this._options.ribbonCount) {
                this.addRibbon();
            }
        },
        _draw: function () {
            if (!this._context || !this._canvas) return;
            this._drawBackground();
            this._context.clearRect(0, 0, this._width, this._height);
            for (var a = 0; a < this._ribbons.length; ++a) {
                var ribbon = this._ribbons[a];
                if (!ribbon || !Array.isArray(ribbon)) continue;
                for (var b = 0; b < ribbon.length; ++b) {
                    this._drawSection(ribbon[b]);
                }
            }
        },
        // Draw ribbons
        _onDraw: function () {
            if (this._destroyed) return;
            if (!this._context || !this._canvas) {
                var raf0 = requestAnimationFrame(this._onDraw);
                this._raf = raf0;
                return;
            }

            // X11 may map a window after the initial options are applied, so
            // the first layout can be 0x0. Re-read the viewport each frame.
            if (typeof window !== "undefined") {
                var vw = window.innerWidth || 0;
                var vh = window.innerHeight || 0;
                if (
                    vw > 0 &&
                    vh > 0 &&
                    (Math.abs(vw - this._width) > 0.5 ||
                        Math.abs(vh - this._height) > 0.5)
                ) {
                    this._onResize();
                }
            }

            if (this._stretch && this._epochMs) {
                var target = this._targetFrame();
                var steps = target - this._frame;
                if (steps < 0) steps = 0;
                if (steps > 600) {
                    this._frame = target - 600;
                    steps = 600;
                }
                for (var s = 0; s < steps; s++) {
                    this._step();
                    this._frame++;
                }
            } else {
                this._step();
            }

            this._draw();

            // Reuse pre-bound _onDraw (constructor) — do NOT .bind() every frame
            var raf = requestAnimationFrame(this._onDraw);
            this._raf = raf;
            if (typeof window !== 'undefined') {
                window.AnimationId = raf;
            }
            if (typeof AnimationId !== 'undefined') {
                AnimationId = raf;
            }
        },
        // Update container size info
        _onResize: function(e) {
            if (this._destroyed) return;
            var screen = screenInfo(e);
            this._width = screen.width;
            this._height = screen.height;
            if (this._stretch) {
                if (this._sceneWidth <= 1 || this._sceneHeight <= 1) {
                    this._sceneWidth = Math.max(1, Number(this._options.sceneWidth) || this._width);
                    this._sceneHeight = Math.max(1, Number(this._options.sceneHeight) || this._height);
                }
            } else {
                this._sceneWidth = this._width;
                this._sceneHeight = this._height;
            }
            if (this._canvas) {
                this._canvas.width = this._width;
                this._canvas.height = this._height;
                if (this._context) {
                    this._context.globalAlpha = this._options.colorAlpha;
                }
            }
            if (this._bgCanvas) {
                this._bgCanvas.width = this._width;
                this._bgCanvas.height = this._height;
            }
            this._drawBackground();
        },
        // Update container size info
        _onScroll: function(e) {
            if (this._destroyed) return;
            var screen = screenInfo(e);
            this._scroll = screen.scrolly;
        },
        /** Full teardown — required when settings preview restarts classic often */
        destroy: function () {
            this._destroyed = true;
            if (this._raf != null) {
                cancelAnimationFrame(this._raf);
                this._raf = null;
            }
            try {
                cancelAnimationFrame(window.AnimationId);
            } catch (_) {}
            try {
                if (typeof AnimationId !== 'undefined') {
                    cancelAnimationFrame(AnimationId);
                }
            } catch (_) {}
            window.removeEventListener('resize', this._onResize);
            window.removeEventListener('scroll', this._onScroll);
            if (this._canvas && this._canvas.parentNode) {
                this._canvas.parentNode.removeChild(this._canvas);
            }
            if (this._bgCanvas && this._bgCanvas.parentNode) {
                this._bgCanvas.parentNode.removeChild(this._bgCanvas);
            }
            this._canvas = null;
            this._context = null;
            this._bgCanvas = null;
            this._bgContext = null;
            this._ribbons = [];
        },
    };
    // export
    return Factory;
});
export default Ribbons;
