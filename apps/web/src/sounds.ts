let enabled = true;
export const setSoundEnabled = (value: boolean): void => { enabled = value; };
export const playSound = (name: string): void => { if (!enabled || typeof window === "undefined") return; try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = name === "hu" ? 880 : name === "gang" ? 660 : 440; gain.gain.value = 0.035; oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.08); } catch { /* audio is optional */ } };
export const speak = (text: string): void => { if (enabled && "speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); };
