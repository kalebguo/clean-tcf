// Traditional -> Simplified Chinese, line by line (stdin -> stdout), with the system ICU transform.
import Foundation
while let line = readLine(strippingNewline: true) {
    print(line.applyingTransform(StringTransform("Hant-Hans"), reverse: false) ?? line)
}
