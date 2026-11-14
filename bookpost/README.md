# Bookpost

Select an ACSM ticket on [Bookpost](https://h-harder.github.io/bookpost/) and send the resulting book directly to your Readest library. The desktop workflow supports Chrome and Edge. An account at Readest is required for cloud delivery.

## First use

1. Download **Bookpost helper** on the site. Unzip the archive and keep the extracted folder.
2. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the folder that contains `manifest.json`.
3. Reload Bookpost, drop your `.acsm` ticket, and choose **Continue to Readest**.
4. Choose **Convert & send**. If Readest opens its sign-in page, sign in there. Keep the transfer tab open until Readest confirms the import.

## Transfers

GitHub Pages serves the interface and helper. The helper contacts the [upstream converter](https://github.com/chrisvariety/acsm-converter) when you initiate a conversion. It sends the original ticket body to the hosted converter and reads its progress records followed by the book bytes. The helper transfers the result to the file input on [Readest’s official Send page](https://web.readest.com/send). Readest handles authentication, duplicate detection, cloud quota and sync. The helper reads the import result shown by that page. It does not access account tokens or passwords.

The converter determines the book’s format. A PDF edition requires a second click to send it as a PDF. If the publisher requires a manual download, the transfer offers the converter’s continuation page. Use its publisher link for the intermediate file, then choose that file back in Bookpost to finish the existing transfer. The finished ebook is handed to Readest in memory.

The tab retains the converted book after a delivery error. **Retry delivery** sends those bytes again without redeeming the ticket again. Closing the transfer tab discards its copy. If confirmation is interrupted, check the Readest tab before retrying. Previously fulfilled, expired or provider-restricted tickets can fail at the converter.

## Import from the Readest app

On macOS, iOS or iPadOS, another option is to open **+ → From Web Browser** in the installed Readest app. Enter `https://www.acsm-converter.com/` as the address, choose your ticket there and convert it. Readest handles supported downloads from that browser and adds them to the local library. See the [Readest import guide](https://readest.com/docs/library#import-options) for the app’s import and sync options.

## Source and packaging

The static page lives in this directory. `helper/` contains the complete Manifest V3 extension and the page’s shared styles and file validation. The launcher’s host and path are explicitly restricted to this GitHub Pages installation. To deploy elsewhere, change the site address in `manifest.json`, `launch.js`, `router.js`, the HTML links and this README, then regenerate the ZIP. The extension does not require a development server or a build step.

From this directory, rebuild the helper download with:

```sh
(cd helper && zip -q -X ../bookpost-helper.zip *)
```

The Readest integration follows its [Send page](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/send/page.tsx). Changes to the converter’s response format or Readest’s file input or import receipt may require a helper update.

## Credits

The carrier-pigeon illustration is by Pearson Scott Foresman and was released into the public domain. [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Carrier_Pigeon_(PSF).jpg)

Instrument Serif is distributed under the SIL Open Font License. See [FONT-LICENSE.txt](./helper/FONT-LICENSE.txt).
