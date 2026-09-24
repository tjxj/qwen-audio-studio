#import <Cocoa/Cocoa.h>

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [NSApp activateIgnoringOtherApps:YES];
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        panel.title = @"选择音频输出文件夹";
        panel.prompt = @"选择此文件夹";
        panel.canChooseDirectories = YES;
        panel.canChooseFiles = NO;
        panel.canCreateDirectories = YES;
        panel.allowsMultipleSelection = NO;
        NSDictionary *body;
        if ([panel runModal] == NSModalResponseOK && panel.URL) {
            body = @{ @"cancelled": @NO, @"path": panel.URL.path };
        } else {
            body = @{ @"cancelled": @YES };
        }
        NSData *data = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
        fwrite(data.bytes, 1, data.length, stdout);
        return 0;
    }
}
