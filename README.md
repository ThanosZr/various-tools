# Various Tools

A collection of practical tools and utilities for documents, automation, engineering, and everyday tasks.

## Tools

| Tool | Version | Description | Download |
| --- | --- | --- | --- |
| ReaderCapture | [0.4.1](https://github.com/ThanosZr/various-tools/tree/reader-capture/v0.4/reader-capture) | Fast positioned snapshots, precise page merging and automatic retries for temporary viewer instability. | [ZIP](https://github.com/ThanosZr/various-tools/archive/refs/heads/reader-capture/v0.4.zip) |
| ReaderCapture archive | [0.3](https://github.com/ThanosZr/various-tools/tree/reader-capture/v0.3/reader-capture) | Incremental page capture with careful scrolling and sticky-bar checks. | [ZIP](https://github.com/ThanosZr/various-tools/archive/refs/heads/reader-capture/v0.3.zip) |
| ReaderCapture archive | [0.2](https://github.com/ThanosZr/various-tools/tree/reader-capture/v0.2/reader-capture) | Continuous document capture with a separate page splitter. | [ZIP](https://github.com/ThanosZr/various-tools/archive/refs/heads/reader-capture/v0.2.zip) |
| ReaderCapture archive | [0.1](https://github.com/ThanosZr/various-tools/tree/reader-capture/v0.1/reader-capture) | Previous page-by-page capture and visual calibration. | [ZIP](https://github.com/ThanosZr/various-tools/archive/refs/heads/reader-capture/v0.1.zip) |

## Organization

Each tool has its own directory, installation instructions, source code, tests and validation notes. Each version is stored on a branch named `<tool>/v<version>`.

The `main` branch contains the catalog. Open the corresponding version branch for the complete tool. After extracting a ReaderCapture branch ZIP, load its **reader-capture/extension** directory at **chrome://extensions** using **Load unpacked**.

ReaderCapture 0.1 and 0.2 were previously numbered 2.0.0 and 3.0.0. This numbering change preserves their respective functionality. The extension uses numeric versions 0.1.0 and 0.2.0 internally and displays 0.1 and 0.2.
