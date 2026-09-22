# MIT License

Copyright (c) 2024 Travis Fischer

Copyright (c) 2026 crscarolina

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Third-party components

This project is a fork of
[kindle-ai-export](https://github.com/transitive-bullshit/kindle-ai-export) by
Travis Fischer, whose copyright is retained above.

It builds on, but does not redistribute, several separately licensed
components:

- **Kokoro-82M** (Apache-2.0), downloaded from the Hugging Face Hub at first
  narration rather than shipped here.
- **ffmpeg**, invoked from `PATH` as a separate program. Homebrew's build is
  configured with `--enable-gpl`, so that binary is GPL-licensed; it is not
  distributed with this project.
- **Google Chrome**, driven through Playwright. Not distributed.
- **Claude Code**, invoked as an external command for the transcription
  cleanup pass. Not distributed.

A release build of the macOS app copies `node_modules` into the bundle, which
does redistribute those packages. They are predominantly MIT, Apache-2.0, ISC
and BSD; `@img/sharp-libvips-darwin-x64` is LGPL-3.0-or-later and ships as a
separate `libvips-cpp` dynamic library, so it remains replaceable as that
licence requires.
