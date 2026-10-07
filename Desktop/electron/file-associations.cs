using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Drawing;
using System.IO;

[ComImport, Guid("F04061AC-1659-4A3F-A954-775AA57FC083"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAssocHandler {
  void GetName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  void GetUIName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  void GetIconLocation([MarshalAs(UnmanagedType.LPWStr)] out string path, out int index);
  [PreserveSig] int IsRecommended();
  void MakeDefault([MarshalAs(UnmanagedType.LPWStr)] string description);
  void Invoke(IDataObject data);
  void CreateInvoker(IDataObject data, out IntPtr invoker);
}
[ComImport, Guid("973810AE-9599-4B88-9E4D-6EE98C9552DA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEnumAssocHandlers {
  [PreserveSig] int Next(uint count, [MarshalAs(UnmanagedType.Interface)] out IAssocHandler handler, out uint fetched);
}
[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
  void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IDataObject data);
  void GetParent(out IShellItem parent);
  void GetDisplayName(uint kind, out IntPtr name);
  void GetAttributes(uint mask, out uint attributes);
  void Compare(IShellItem other, uint hint, out int order);
}
public class FileApplication {
  public string id;
  public string label;
  public string icon;
}
public static class FileAssociations {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHAssocEnumHandlers(string extension, uint filter, out IEnumAssocHandlers handlers);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct OpenAsInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string file;
    [MarshalAs(UnmanagedType.LPWStr)] public string className;
    public uint flags;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHOpenWithDialog(IntPtr window, ref OpenAsInfo info);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern uint ExtractIconEx(string path, int index, IntPtr[] large, IntPtr[] small, uint count);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
  static string IconData(IAssocHandler handler) {
    IntPtr handle = IntPtr.Zero;
    try {
      string path; int index; handler.GetIconLocation(out path, out index);
      if (String.IsNullOrEmpty(path) || path.StartsWith("@")) return null;
      var icons = new IntPtr[1];
      ExtractIconEx(Environment.ExpandEnvironmentVariables(path), index, null, icons, 1);
      handle = icons[0];
      if (handle == IntPtr.Zero) return null;
      using (var icon = Icon.FromHandle(handle))
      using (var bitmap = icon.ToBitmap())
      using (var stream = new MemoryStream()) {
        bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
        return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
      }
    } catch { return null; }
    finally { if (handle != IntPtr.Zero) DestroyIcon(handle); }
  }
  public static FileApplication[] List(string extension) {
    var result = new List<FileApplication>();
    IEnumAssocHandlers handlers = null;
    try {
      SHAssocEnumHandlers(extension, 1, out handlers);
      IAssocHandler handler; uint fetched;
      while (result.Count < 24 && handlers.Next(1, out handler, out fetched) == 0 && fetched == 1) {
        try {
          string id, label; handler.GetName(out id); handler.GetUIName(out label);
          if (!String.IsNullOrEmpty(id) && !String.IsNullOrEmpty(label))
            result.Add(new FileApplication { id = id, label = label, icon = IconData(handler) });
        } catch { }
        finally { Marshal.ReleaseComObject(handler); }
      }
    } catch { }
    finally { if (handlers != null) Marshal.ReleaseComObject(handlers); }
    return result.ToArray();
  }
  public static void Open(string path, string id) {
    IEnumAssocHandlers handlers = null; IShellItem item = null; IDataObject data = null;
    try {
      SHAssocEnumHandlers(Path.GetExtension(path), 1, out handlers);
      IAssocHandler handler; uint fetched; int count = 0;
      while (count++ < 64 && handlers.Next(1, out handler, out fetched) == 0 && fetched == 1) {
        try {
          string name; handler.GetName(out name);
          if (!String.Equals(name, id, StringComparison.Ordinal)) continue;
          var iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
          SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out item);
          var binding = new Guid("B8C0BD9F-ED24-455C-83E6-D5390C4FE8C4");
          var dataId = new Guid("0000010E-0000-0000-C000-000000000046");
          item.BindToHandler(IntPtr.Zero, ref binding, ref dataId, out data);
          handler.Invoke(data);
          return;
        } finally { Marshal.ReleaseComObject(handler); }
      }
      throw new InvalidOperationException("Application is no longer associated with this file type");
    } finally {
      if (data != null) Marshal.ReleaseComObject(data);
      if (item != null) Marshal.ReleaseComObject(item);
      if (handlers != null) Marshal.ReleaseComObject(handlers);
    }
  }
  public static void Choose(string path, string window) {
    var info = new OpenAsInfo { file = path, flags = 4 };
    try { SHOpenWithDialog(new IntPtr(Int64.Parse(window)), ref info); }
    catch (COMException error) { if (error.ErrorCode != unchecked((int)0x800704C7)) throw; }
  }
}
