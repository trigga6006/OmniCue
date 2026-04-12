/**
 * Navigation catalog — structured registry of OS-navigable locations.
 * Each entry declares a canonical ID, natural-language aliases,
 * and per-platform LaunchSpec so the launcher never guesses from raw strings.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type NavCategory = 'settings' | 'utility' | 'folder' | 'control-panel'

export type LaunchSpec =
  | { kind: 'uri'; target: string }
  | { kind: 'path'; target: string }
  | { kind: 'shell-folder'; target: string }
  | { kind: 'command'; command: string; args?: string[] }
  | { kind: 'app'; name: string }

export interface NavEntry {
  id: string
  aliases: string[]
  category: NavCategory
  description: string
  win32?: LaunchSpec
  darwin?: LaunchSpec
  linux?: LaunchSpec
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export const NAV_CATALOG: NavEntry[] = [
  // ── Settings — System ───────────────────────────────────────────────────
  {
    id: 'display-settings',
    aliases: ['display', 'display settings', 'screen resolution', 'monitor settings', 'scaling'],
    category: 'settings',
    description: 'Display settings',
    win32: { kind: 'uri', target: 'ms-settings:display' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Displays.prefPane'] },
  },
  {
    id: 'sound-settings',
    aliases: ['sound', 'sound settings', 'audio', 'audio settings', 'volume settings', 'speakers', 'microphone settings'],
    category: 'settings',
    description: 'Sound settings',
    win32: { kind: 'uri', target: 'ms-settings:sound' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Sound.prefPane'] },
  },
  {
    id: 'notifications',
    aliases: ['notifications', 'notification settings', 'notification center'],
    category: 'settings',
    description: 'Notification settings',
    win32: { kind: 'uri', target: 'ms-settings:notifications' },
    darwin: { kind: 'command', command: 'open', args: ['x-apple.systempreferences:com.apple.Notifications-Settings.extension'] },
  },
  {
    id: 'focus-assist',
    aliases: ['focus assist', 'do not disturb', 'dnd', 'quiet hours', 'focus mode'],
    category: 'settings',
    description: 'Focus assist / Do Not Disturb settings',
    win32: { kind: 'uri', target: 'ms-settings:quiethours' },
    darwin: { kind: 'command', command: 'open', args: ['x-apple.systempreferences:com.apple.Focus-Settings.extension'] },
  },
  {
    id: 'power-settings',
    aliases: ['power', 'power settings', 'battery', 'sleep settings', 'power plan', 'energy settings', 'power and sleep'],
    category: 'settings',
    description: 'Power & sleep settings',
    win32: { kind: 'uri', target: 'ms-settings:powersleep' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Battery.prefPane'] },
  },
  {
    id: 'storage',
    aliases: ['storage', 'storage settings', 'disk space', 'free up space', 'storage sense'],
    category: 'settings',
    description: 'Storage settings',
    win32: { kind: 'uri', target: 'ms-settings:storagesense' },
  },
  {
    id: 'multitasking',
    aliases: ['multitasking', 'snap', 'snap layouts', 'virtual desktops', 'snap settings'],
    category: 'settings',
    description: 'Multitasking settings',
    win32: { kind: 'uri', target: 'ms-settings:multitasking' },
  },
  {
    id: 'remote-desktop',
    aliases: ['remote desktop', 'rdp', 'remote desktop settings'],
    category: 'settings',
    description: 'Remote Desktop settings',
    win32: { kind: 'uri', target: 'ms-settings:remotedesktop' },
  },
  {
    id: 'clipboard-settings',
    aliases: ['clipboard history', 'clipboard settings'],
    category: 'settings',
    description: 'Clipboard settings',
    win32: { kind: 'uri', target: 'ms-settings:clipboard' },
  },
  {
    id: 'about-pc',
    aliases: ['about this pc', 'about my computer', 'system info', 'computer name', 'pc specs', 'about'],
    category: 'settings',
    description: 'About this PC',
    win32: { kind: 'uri', target: 'ms-settings:about' },
    darwin: { kind: 'app', name: 'About This Mac' },
  },
  {
    id: 'system-settings',
    aliases: ['system settings', 'settings', 'windows settings', 'preferences'],
    category: 'settings',
    description: 'System settings',
    win32: { kind: 'uri', target: 'ms-settings:' },
    darwin: { kind: 'app', name: 'System Preferences' },
  },

  // ── Settings — Network ──────────────────────────────────────────────────
  {
    id: 'wifi',
    aliases: ['wifi', 'wi-fi', 'wi-fi settings', 'wifi settings', 'wireless', 'wireless settings'],
    category: 'settings',
    description: 'Wi-Fi settings',
    win32: { kind: 'uri', target: 'ms-settings:network-wifi' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Network.prefPane'] },
  },
  {
    id: 'bluetooth',
    aliases: ['bluetooth', 'bluetooth settings', 'pair device', 'bluetooth devices'],
    category: 'settings',
    description: 'Bluetooth settings',
    win32: { kind: 'uri', target: 'ms-settings:bluetooth' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Bluetooth.prefPane'] },
  },
  {
    id: 'ethernet',
    aliases: ['ethernet', 'wired connection', 'lan', 'ethernet settings'],
    category: 'settings',
    description: 'Ethernet settings',
    win32: { kind: 'uri', target: 'ms-settings:network-ethernet' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Network.prefPane'] },
  },
  {
    id: 'vpn',
    aliases: ['vpn', 'vpn settings'],
    category: 'settings',
    description: 'VPN settings',
    win32: { kind: 'uri', target: 'ms-settings:network-vpn' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Network.prefPane'] },
  },
  {
    id: 'hotspot',
    aliases: ['mobile hotspot', 'hotspot', 'tethering'],
    category: 'settings',
    description: 'Mobile hotspot settings',
    win32: { kind: 'uri', target: 'ms-settings:network-mobilehotspot' },
  },
  {
    id: 'airplane-mode',
    aliases: ['airplane mode', 'flight mode'],
    category: 'settings',
    description: 'Airplane mode',
    win32: { kind: 'uri', target: 'ms-settings:network-airplanemode' },
  },
  {
    id: 'proxy',
    aliases: ['proxy', 'proxy settings'],
    category: 'settings',
    description: 'Proxy settings',
    win32: { kind: 'uri', target: 'ms-settings:network-proxy' },
  },
  {
    id: 'network-status',
    aliases: ['network status', 'network settings', 'internet settings', 'connection status'],
    category: 'settings',
    description: 'Network status',
    win32: { kind: 'uri', target: 'ms-settings:network-status' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Network.prefPane'] },
  },

  // ── Settings — Apps ─────────────────────────────────────────────────────
  {
    id: 'installed-apps',
    aliases: ['installed apps', 'add remove programs', 'uninstall', 'programs and features', 'apps and features', 'uninstall programs'],
    category: 'settings',
    description: 'Installed apps',
    win32: { kind: 'uri', target: 'ms-settings:appsfeatures' },
    darwin: { kind: 'command', command: 'open', args: ['/Applications'] },
  },
  {
    id: 'default-apps',
    aliases: ['default apps', 'default browser', 'default programs', 'file associations', 'default applications'],
    category: 'settings',
    description: 'Default apps',
    win32: { kind: 'uri', target: 'ms-settings:defaultapps' },
  },
  {
    id: 'startup-apps',
    aliases: ['startup apps', 'startup programs', 'login items', 'apps that run at startup', 'startup applications'],
    category: 'settings',
    description: 'Apps that launch when you sign in',
    win32: { kind: 'uri', target: 'ms-settings:startupapps' },
  },
  {
    id: 'optional-features',
    aliases: ['optional features', 'windows features', 'turn windows features on'],
    category: 'settings',
    description: 'Optional features',
    win32: { kind: 'uri', target: 'ms-settings:optionalfeatures' },
  },

  // ── Settings — Personalization ──────────────────────────────────────────
  {
    id: 'background',
    aliases: ['wallpaper', 'background', 'desktop background', 'change wallpaper'],
    category: 'settings',
    description: 'Desktop background / wallpaper',
    win32: { kind: 'uri', target: 'ms-settings:personalization-background' },
  },
  {
    id: 'colors',
    aliases: ['colors', 'accent color', 'dark mode', 'light mode', 'theme color', 'color settings'],
    category: 'settings',
    description: 'Color & theme settings',
    win32: { kind: 'uri', target: 'ms-settings:colors' },
  },
  {
    id: 'themes',
    aliases: ['themes', 'theme settings', 'change theme'],
    category: 'settings',
    description: 'Theme settings',
    win32: { kind: 'uri', target: 'ms-settings:themes' },
  },
  {
    id: 'lock-screen',
    aliases: ['lock screen', 'lock screen settings'],
    category: 'settings',
    description: 'Lock screen settings',
    win32: { kind: 'uri', target: 'ms-settings:lockscreen' },
  },
  {
    id: 'taskbar',
    aliases: ['taskbar', 'taskbar settings'],
    category: 'settings',
    description: 'Taskbar settings',
    win32: { kind: 'uri', target: 'ms-settings:taskbar' },
  },
  {
    id: 'start-menu',
    aliases: ['start menu', 'start settings', 'start menu settings'],
    category: 'settings',
    description: 'Start menu settings',
    win32: { kind: 'uri', target: 'ms-settings:personalization-start' },
  },
  {
    id: 'fonts',
    aliases: ['fonts', 'installed fonts', 'font settings', 'manage fonts'],
    category: 'settings',
    description: 'Font settings',
    win32: { kind: 'uri', target: 'ms-settings:fonts' },
    darwin: { kind: 'app', name: 'Font Book' },
  },

  // ── Settings — Accounts ─────────────────────────────────────────────────
  {
    id: 'accounts',
    aliases: ['accounts', 'user accounts', 'my account'],
    category: 'settings',
    description: 'Account settings',
    win32: { kind: 'uri', target: 'ms-settings:accounts' },
  },
  {
    id: 'email-accounts',
    aliases: ['email accounts', 'mail accounts'],
    category: 'settings',
    description: 'Email & accounts',
    win32: { kind: 'uri', target: 'ms-settings:emailandaccounts' },
  },
  {
    id: 'sign-in',
    aliases: ['sign in options', 'login options', 'password settings', 'windows hello', 'sign in settings'],
    category: 'settings',
    description: 'Sign-in options',
    win32: { kind: 'uri', target: 'ms-settings:signinoptions' },
  },

  // ── Settings — Time & Language ──────────────────────────────────────────
  {
    id: 'date-time',
    aliases: ['date and time', 'date', 'time', 'timezone', 'time zone', 'clock'],
    category: 'settings',
    description: 'Date & time settings',
    win32: { kind: 'uri', target: 'ms-settings:dateandtime' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/DateAndTime.prefPane'] },
  },
  {
    id: 'language',
    aliases: ['language', 'display language', 'keyboard language', 'region', 'language settings'],
    category: 'settings',
    description: 'Language & region settings',
    win32: { kind: 'uri', target: 'ms-settings:regionlanguage' },
  },
  {
    id: 'keyboard-settings',
    aliases: ['keyboard settings', 'keyboard', 'input settings', 'typing settings'],
    category: 'settings',
    description: 'Keyboard settings',
    win32: { kind: 'uri', target: 'ms-settings:keyboard' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Keyboard.prefPane'] },
  },

  // ── Settings — Privacy & Security ───────────────────────────────────────
  {
    id: 'privacy',
    aliases: ['privacy', 'privacy settings'],
    category: 'settings',
    description: 'Privacy settings',
    win32: { kind: 'uri', target: 'ms-settings:privacy' },
  },
  {
    id: 'location-privacy',
    aliases: ['location', 'location services', 'gps', 'location privacy'],
    category: 'settings',
    description: 'Location services settings',
    win32: { kind: 'uri', target: 'ms-settings:privacy-location' },
  },
  {
    id: 'camera-privacy',
    aliases: ['camera', 'camera permissions', 'webcam', 'camera privacy', 'camera settings'],
    category: 'settings',
    description: 'Camera privacy settings',
    win32: { kind: 'uri', target: 'ms-settings:privacy-webcam' },
  },
  {
    id: 'microphone-privacy',
    aliases: ['microphone privacy', 'mic permissions', 'microphone permissions'],
    category: 'settings',
    description: 'Microphone privacy settings',
    win32: { kind: 'uri', target: 'ms-settings:privacy-microphone' },
  },
  {
    id: 'windows-security',
    aliases: ['windows security', 'virus protection', 'defender', 'antivirus', 'windows defender'],
    category: 'settings',
    description: 'Windows Security',
    win32: { kind: 'uri', target: 'ms-settings:windowsdefender' },
  },

  // ── Settings — Update ───────────────────────────────────────────────────
  {
    id: 'windows-update',
    aliases: ['windows update', 'check for updates', 'system update', 'updates'],
    category: 'settings',
    description: 'Windows Update',
    win32: { kind: 'uri', target: 'ms-settings:windowsupdate' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/SoftwareUpdate.prefPane'] },
  },
  {
    id: 'recovery',
    aliases: ['recovery', 'reset this pc', 'advanced startup', 'recovery options'],
    category: 'settings',
    description: 'Recovery options',
    win32: { kind: 'uri', target: 'ms-settings:recovery' },
  },
  {
    id: 'activation',
    aliases: ['activation', 'windows activation', 'product key'],
    category: 'settings',
    description: 'Windows activation',
    win32: { kind: 'uri', target: 'ms-settings:activation' },
  },

  // ── Settings — Accessibility ────────────────────────────────────────────
  {
    id: 'accessibility',
    aliases: ['accessibility', 'ease of access', 'accessibility settings'],
    category: 'settings',
    description: 'Accessibility settings',
    win32: { kind: 'uri', target: 'ms-settings:easeofaccess' },
  },
  {
    id: 'text-size',
    aliases: ['text size', 'font size', 'make text bigger'],
    category: 'settings',
    description: 'Text size settings',
    win32: { kind: 'uri', target: 'ms-settings:easeofaccess-display' },
  },
  {
    id: 'magnifier',
    aliases: ['magnifier', 'screen magnifier', 'zoom'],
    category: 'settings',
    description: 'Magnifier settings',
    win32: { kind: 'uri', target: 'ms-settings:easeofaccess-magnifier' },
  },
  {
    id: 'narrator',
    aliases: ['narrator', 'screen reader', 'voiceover'],
    category: 'settings',
    description: 'Screen reader settings',
    win32: { kind: 'uri', target: 'ms-settings:easeofaccess-narrator' },
    darwin: { kind: 'command', command: 'open', args: ['x-apple.systempreferences:com.apple.Accessibility-Settings.extension'] },
  },
  {
    id: 'high-contrast',
    aliases: ['high contrast', 'contrast themes'],
    category: 'settings',
    description: 'High contrast / contrast themes',
    win32: { kind: 'uri', target: 'ms-settings:easeofaccess-highcontrast' },
  },

  // ── Settings — Gaming ──────────────────────────────────────────────────
  {
    id: 'game-bar',
    aliases: ['game bar', 'xbox game bar', 'game bar settings'],
    category: 'settings',
    description: 'Game Bar settings',
    win32: { kind: 'uri', target: 'ms-settings:gaming-gamebar' },
  },
  {
    id: 'game-mode',
    aliases: ['game mode', 'gaming mode'],
    category: 'settings',
    description: 'Game Mode settings',
    win32: { kind: 'uri', target: 'ms-settings:gaming-gamemode' },
  },

  // ── Settings — Devices ─────────────────────────────────────────────────
  {
    id: 'mouse-settings',
    aliases: ['mouse', 'mouse settings', 'cursor settings', 'pointer settings'],
    category: 'settings',
    description: 'Mouse settings',
    win32: { kind: 'uri', target: 'ms-settings:mousetouchpad' },
  },
  {
    id: 'touchpad',
    aliases: ['touchpad', 'touchpad settings', 'trackpad', 'trackpad settings'],
    category: 'settings',
    description: 'Touchpad settings',
    win32: { kind: 'uri', target: 'ms-settings:devices-touchpad' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/Trackpad.prefPane'] },
  },
  {
    id: 'printers',
    aliases: ['printers', 'printers and scanners', 'printer settings', 'add printer'],
    category: 'settings',
    description: 'Printers & scanners',
    win32: { kind: 'uri', target: 'ms-settings:printers' },
    darwin: { kind: 'command', command: 'open', args: ['/System/Library/PreferencePanes/PrintAndFax.prefPane'] },
  },
  {
    id: 'usb',
    aliases: ['usb', 'usb settings', 'usb devices'],
    category: 'settings',
    description: 'USB device settings',
    win32: { kind: 'uri', target: 'ms-settings:usb' },
  },

  // ── Control Panel Items ─────────────────────────────────────────────────
  {
    id: 'firewall',
    aliases: ['firewall', 'windows firewall', 'firewall settings'],
    category: 'control-panel',
    description: 'Windows Firewall',
    win32: { kind: 'command', command: 'firewall.cpl' },
  },
  {
    id: 'control-panel',
    aliases: ['control panel'],
    category: 'control-panel',
    description: 'Control Panel',
    win32: { kind: 'command', command: 'control' },
  },
  {
    id: 'network-connections',
    aliases: ['network connections', 'network adapters', 'change adapter settings'],
    category: 'control-panel',
    description: 'Network connections',
    win32: { kind: 'command', command: 'ncpa.cpl' },
  },
  {
    id: 'internet-options',
    aliases: ['internet options', 'internet settings'],
    category: 'control-panel',
    description: 'Internet Options',
    win32: { kind: 'command', command: 'inetcpl.cpl' },
  },
  {
    id: 'system-properties',
    aliases: ['system properties', 'advanced system settings'],
    category: 'control-panel',
    description: 'System Properties',
    win32: { kind: 'command', command: 'sysdm.cpl' },
  },

  // ── System Utilities ────────────────────────────────────────────────────
  {
    id: 'task-manager',
    aliases: ['task manager', 'processes', 'running processes'],
    category: 'utility',
    description: 'Task Manager',
    win32: { kind: 'command', command: 'taskmgr.exe' },
    darwin: { kind: 'app', name: 'Activity Monitor' },
  },
  {
    id: 'device-manager',
    aliases: ['device manager', 'drivers', 'hardware manager', 'devices'],
    category: 'utility',
    description: 'Device Manager',
    win32: { kind: 'command', command: 'devmgmt.msc' },
    darwin: { kind: 'app', name: 'System Information' },
  },
  {
    id: 'disk-management',
    aliases: ['disk management', 'partitions', 'format drive', 'manage disks'],
    category: 'utility',
    description: 'Disk Management',
    win32: { kind: 'command', command: 'diskmgmt.msc' },
    darwin: { kind: 'app', name: 'Disk Utility' },
  },
  {
    id: 'event-viewer',
    aliases: ['event viewer', 'event log', 'system logs', 'windows logs'],
    category: 'utility',
    description: 'Event Viewer',
    win32: { kind: 'command', command: 'eventvwr.msc' },
    darwin: { kind: 'app', name: 'Console' },
  },
  {
    id: 'system-information',
    aliases: ['system information', 'sysinfo', 'msinfo', 'hardware info'],
    category: 'utility',
    description: 'System Information',
    win32: { kind: 'command', command: 'msinfo32.exe' },
    darwin: { kind: 'app', name: 'System Information' },
  },
  {
    id: 'resource-monitor',
    aliases: ['resource monitor', 'performance monitor', 'cpu usage', 'memory usage'],
    category: 'utility',
    description: 'Resource Monitor',
    win32: { kind: 'command', command: 'resmon.exe' },
    darwin: { kind: 'app', name: 'Activity Monitor' },
  },
  {
    id: 'services',
    aliases: ['services', 'windows services', 'background services'],
    category: 'utility',
    description: 'Services',
    win32: { kind: 'command', command: 'services.msc' },
  },
  {
    id: 'registry-editor',
    aliases: ['registry', 'regedit', 'registry editor'],
    category: 'utility',
    description: 'Registry Editor',
    win32: { kind: 'command', command: 'regedit.exe' },
  },
  {
    id: 'environment-variables',
    aliases: ['environment variables', 'env vars', 'path variable', 'system path', 'edit environment variables'],
    category: 'utility',
    description: 'Environment Variables',
    win32: { kind: 'command', command: 'rundll32.exe', args: ['sysdm.cpl,EditEnvironmentVariables'] },
  },
  {
    id: 'command-prompt',
    aliases: ['command prompt', 'cmd'],
    category: 'utility',
    description: 'Command Prompt',
    win32: { kind: 'command', command: 'cmd.exe' },
    darwin: { kind: 'app', name: 'Terminal' },
  },
  {
    id: 'powershell',
    aliases: ['powershell', 'ps', 'windows powershell'],
    category: 'utility',
    description: 'PowerShell',
    win32: { kind: 'command', command: 'powershell.exe' },
  },
  {
    id: 'windows-terminal',
    aliases: ['windows terminal', 'wt', 'terminal'],
    category: 'utility',
    description: 'Windows Terminal',
    win32: { kind: 'command', command: 'wt.exe' },
    darwin: { kind: 'app', name: 'Terminal' },
  },
  {
    id: 'snipping-tool',
    aliases: ['snipping tool', 'screenshot', 'screen capture', 'snip'],
    category: 'utility',
    description: 'Snipping Tool',
    win32: { kind: 'command', command: 'SnippingTool.exe' },
    darwin: { kind: 'app', name: 'Screenshot' },
  },
  {
    id: 'calculator',
    aliases: ['calculator', 'calc'],
    category: 'utility',
    description: 'Calculator',
    win32: { kind: 'command', command: 'calc.exe' },
    darwin: { kind: 'app', name: 'Calculator' },
  },
  {
    id: 'notepad',
    aliases: ['notepad', 'text editor'],
    category: 'utility',
    description: 'Notepad',
    win32: { kind: 'command', command: 'notepad.exe' },
    darwin: { kind: 'app', name: 'TextEdit' },
  },
  {
    id: 'paint',
    aliases: ['paint', 'mspaint'],
    category: 'utility',
    description: 'Paint',
    win32: { kind: 'command', command: 'mspaint.exe' },
  },
  {
    id: 'file-explorer',
    aliases: ['file explorer', 'explorer', 'my computer', 'this pc'],
    category: 'utility',
    description: 'File Explorer',
    win32: { kind: 'command', command: 'explorer.exe' },
    darwin: { kind: 'app', name: 'Finder' },
  },
  {
    id: 'disk-cleanup',
    aliases: ['disk cleanup', 'clean up disk', 'free space'],
    category: 'utility',
    description: 'Disk Cleanup',
    win32: { kind: 'command', command: 'cleanmgr.exe' },
  },
  {
    id: 'computer-management',
    aliases: ['computer management'],
    category: 'utility',
    description: 'Computer Management',
    win32: { kind: 'command', command: 'compmgmt.msc' },
  },
  {
    id: 'performance-monitor',
    aliases: ['performance monitor', 'perfmon'],
    category: 'utility',
    description: 'Performance Monitor',
    win32: { kind: 'command', command: 'perfmon.msc' },
  },

  // ── Special Folders ─────────────────────────────────────────────────────
  {
    id: 'downloads',
    aliases: ['downloads', 'download folder', 'my downloads'],
    category: 'folder',
    description: 'Downloads folder',
    win32: { kind: 'path', target: '%USERPROFILE%\\Downloads' },
    darwin: { kind: 'path', target: '~/Downloads' },
  },
  {
    id: 'documents',
    aliases: ['documents', 'my documents', 'documents folder'],
    category: 'folder',
    description: 'Documents folder',
    win32: { kind: 'path', target: '%USERPROFILE%\\Documents' },
    darwin: { kind: 'path', target: '~/Documents' },
  },
  {
    id: 'desktop-folder',
    aliases: ['desktop folder', 'my desktop'],
    category: 'folder',
    description: 'Desktop folder',
    win32: { kind: 'path', target: '%USERPROFILE%\\Desktop' },
    darwin: { kind: 'path', target: '~/Desktop' },
  },
  {
    id: 'pictures',
    aliases: ['pictures', 'my pictures', 'photos folder', 'pictures folder'],
    category: 'folder',
    description: 'Pictures folder',
    win32: { kind: 'path', target: '%USERPROFILE%\\Pictures' },
    darwin: { kind: 'path', target: '~/Pictures' },
  },
  {
    id: 'music',
    aliases: ['music', 'my music', 'music folder'],
    category: 'folder',
    description: 'Music folder',
    win32: { kind: 'path', target: '%USERPROFILE%\\Music' },
    darwin: { kind: 'path', target: '~/Music' },
  },
  {
    id: 'videos',
    aliases: ['videos', 'my videos', 'videos folder'],
    category: 'folder',
    description: 'Videos folder',
    win32: { kind: 'path', target: '%USERPROFILE%\\Videos' },
    darwin: { kind: 'path', target: '~/Movies' },
  },
  {
    id: 'appdata',
    aliases: ['appdata', 'app data', 'application data', 'roaming'],
    category: 'folder',
    description: 'AppData folder',
    win32: { kind: 'path', target: '%APPDATA%' },
    darwin: { kind: 'path', target: '~/Library/Application Support' },
  },
  {
    id: 'local-appdata',
    aliases: ['local appdata', 'local app data'],
    category: 'folder',
    description: 'Local AppData folder',
    win32: { kind: 'path', target: '%LOCALAPPDATA%' },
    darwin: { kind: 'path', target: '~/Library' },
  },
  {
    id: 'temp-folder',
    aliases: ['temp', 'temp folder', 'temporary files', 'tmp'],
    category: 'folder',
    description: 'Temporary files folder',
    win32: { kind: 'path', target: '%TEMP%' },
    darwin: { kind: 'path', target: '/tmp' },
  },
  {
    id: 'recycle-bin',
    aliases: ['recycle bin', 'trash', 'bin', 'rubbish bin'],
    category: 'folder',
    description: 'Recycle Bin',
    win32: { kind: 'shell-folder', target: 'shell:RecycleBinFolder' },
    darwin: { kind: 'command', command: 'open', args: ['/Users/$USER/.Trash'] },
  },
  {
    id: 'recent-files',
    aliases: ['recent files', 'recently opened', 'recent', 'recent items'],
    category: 'folder',
    description: 'Recent files',
    win32: { kind: 'shell-folder', target: 'shell:Recent' },
  },
  {
    id: 'fonts-folder',
    aliases: ['fonts folder', 'installed fonts folder', 'system fonts'],
    category: 'folder',
    description: 'Fonts folder',
    win32: { kind: 'shell-folder', target: 'shell:Fonts' },
    darwin: { kind: 'path', target: '/Library/Fonts' },
  },
  {
    id: 'startup-folder',
    aliases: ['startup folder', 'shell startup', 'autostart folder'],
    category: 'folder',
    description: 'Startup folder',
    win32: { kind: 'shell-folder', target: 'shell:Startup' },
  },
  {
    id: 'user-home',
    aliases: ['home', 'home folder', 'my home', 'user folder', 'home directory'],
    category: 'folder',
    description: 'User home folder',
    win32: { kind: 'path', target: '%USERPROFILE%' },
    darwin: { kind: 'path', target: '~' },
  },
  {
    id: 'program-files',
    aliases: ['program files'],
    category: 'folder',
    description: 'Program Files folder',
    win32: { kind: 'path', target: '%ProgramFiles%' },
    darwin: { kind: 'path', target: '/Applications' },
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

const catalogById = new Map<string, NavEntry>()
for (const entry of NAV_CATALOG) {
  catalogById.set(entry.id, entry)
}

/** Look up a catalog entry by its exact ID. */
export function getNavEntry(id: string): NavEntry | undefined {
  return catalogById.get(id)
}

/** Get a compact summary of catalog entries for LLM context. */
export function getNavCatalogCompact(): string {
  return NAV_CATALOG.map(
    (e) => `${e.id} [${e.category}]: ${e.aliases.slice(0, 3).join(', ')}`
  ).join('\n')
}
