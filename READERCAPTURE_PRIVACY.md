# ReaderCapture — Privacy Policy

Effective date: 26 November 2026  
Applies to ReaderCapture 0.4.1 for Google Chrome.

## Purpose

ReaderCapture is a user-operated document capture tool that turns visible browser content into locally generated images and PDF files. Use it only for content you are authorized to capture.

## Data handled and use

When the user activates the extension or connects it to a tab, ReaderCapture accesses that active tab's identifier, window identifier, URL and title and reads the relevant page layout and scrolling information to locate and capture the requested content. Screenshots may contain any information visible on the selected page, including personal or confidential information. The extension also handles images and project files explicitly imported by the user, capture coordinates, page boundaries, document titles, and user preferences. These are used solely for capture, local editing, page assembly, project restoration and export.

Captured pages and scan tiles are stored in the browser's local IndexedDB databases. Preferences and the last scan reference are stored in Chrome's local extension storage; the connected tab metadata is stored in session storage. Output files are generated on the device and downloaded at the user's request.

## Sharing and transmission

ReaderCapture does not transmit captured content, tab metadata, imported documents, or preferences to the developer or third-party services. It does not use analytics, advertising, tracking, remote code or a cloud account. The extension does not sell or share user data. Users control what they capture, export and subsequently share. Chrome itself is subject to Google's own privacy practices.

## Retention and control

Local pages, scan records and preferences may persist until removed. Users can delete captured pages and start a new page collection in the extension. To remove all extension-held local data, including retained scan tiles and preferences, uninstall the extension from Chrome. Export any wanted files first. Files already downloaded remain in the user's chosen location until the user deletes them. Local storage is not an encrypted vault; avoid capturing sensitive material on shared or untrusted devices.

## Chrome permissions

- `activeTab`: temporary access to the tab explicitly selected by the user for capture.
- `scripting`: injects the packaged local capture script to inspect layout and control scrolling in that tab.
- `sidePanel`: displays the capture and export interface.
- `storage`: stores settings and the selected tab reference locally or for the browser session.
- `downloads`: saves user-requested local PDF, image, archive and project files.
- `unlimitedStorage`: accommodates large local collections of screenshots and scan tiles.

## Limited Use

ReaderCapture's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact and updates

For privacy-related questions, contact the developer through the [Various Tools repository](https://github.com/ThanosZr/various-tools/issues). Do not include private documents or sensitive personal information in public issues. This policy will be updated if the extension's data handling changes.
