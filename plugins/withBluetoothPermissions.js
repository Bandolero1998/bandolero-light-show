const { withInfoPlist, withAndroidManifest } = require('@expo/config-plugins');

function withIOSBluetooth(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSBluetoothAlwaysUsageDescription =
      'BANDOLERO koristi Bluetooth LE za povezivanje sa VLinker/ELM327 OBD adapterom i očitavanje podataka iz vozila.';
    mod.modResults.NSBluetoothPeripheralUsageDescription =
      'BANDOLERO koristi Bluetooth LE za povezivanje sa OBD-II adapterom vozila.';
    return mod;
  });
}

function withAndroidBluetooth(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const permissions = manifest['uses-permission'] || [];
    const add = (name, maxSdkVersion, extraAttributes) => {
      let entry = permissions.find((p) => p.$ && p.$['android:name'] === name);
      if (!entry) {
        entry = { $: { 'android:name': name } };
        permissions.push(entry);
      }
      if (maxSdkVersion) {
        entry.$['android:maxSdkVersion'] = String(maxSdkVersion);
      }
      if (extraAttributes) {
        Object.assign(entry.$, extraAttributes);
      }
    };

    // Android 11 (API 30) and below
    add('android.permission.BLUETOOTH', 30);
    add('android.permission.BLUETOOTH_ADMIN', 30);
    add('android.permission.ACCESS_FINE_LOCATION', 30);
    add('android.permission.ACCESS_COARSE_LOCATION', 30);

    // Android 12+ (API 31+)
    add('android.permission.BLUETOOTH_SCAN', undefined, { 'android:usesPermissionFlags': 'neverForLocation' });
    add('android.permission.BLUETOOTH_CONNECT');

    manifest['uses-permission'] = permissions;
    return mod;
  });
}

module.exports = function withBluetoothPermissions(config) {
  return withAndroidBluetooth(withIOSBluetooth(config));
};
