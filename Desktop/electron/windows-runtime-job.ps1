param([string]$Spec, [string]$Verify)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class DfscRuntimeJob {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet;
    public uint ActiveLimit;
    public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits Basic;
    public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public uint Size;
    public string Reserved, Desktop, Title;
    public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
    public ushort Show, ReservedBytes;
    public IntPtr ReservedData, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr Process, Thread;
    public uint Pid, Tid;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx {
    public Startup Info;
    public IntPtr Attributes;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting info, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr env, string cwd, ref StartupEx startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Require(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var text = new StringBuilder("\""); int slashes = 0;
    foreach (char character in value) {
      if (character == '\\') { slashes++; continue; }
      if (character == '"') { text.Append('\\', slashes * 2 + 1); text.Append('"'); slashes = 0; continue; }
      text.Append('\\', slashes); slashes = 0; text.Append(character);
    }
    return text.Append('\\', slashes * 2).Append('"').ToString();
  }
  static bool Empty(IntPtr job) {
    Accounting info;
    Require(QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
    return info.ActiveProcesses == 0;
  }
  public static bool Released(string name) {
    IntPtr job = OpenJobObject(4, false, name);
    if (job == IntPtr.Zero) {
      if (Marshal.GetLastWin32Error() == 2) return true;
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    try {
      for (int i = 0; i < 100; i++) { if (Empty(job)) return true; Thread.Sleep(50); }
      return false;
    } finally { CloseHandle(job); }
  }
  public static int Run(string name, string executable, string[] args, string cwd) {
    IntPtr job = CreateJobObject(IntPtr.Zero, name);
    if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    ProcessInfo process = new ProcessInfo();
    IntPtr attributes = IntPtr.Zero, jobList = IntPtr.Zero;
    bool initialized = false;
    try {
      var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000;
      Require(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
      var startup = new StartupEx(); startup.Info.Size = (uint)Marshal.SizeOf(typeof(StartupEx)); startup.Info.Flags = 0x100;
      startup.Info.Input = GetStdHandle(-10); startup.Info.Output = GetStdHandle(-11); startup.Info.Error = GetStdHandle(-12);
      foreach (IntPtr handle in new [] {startup.Info.Input, startup.Info.Output, startup.Info.Error}) Require(SetHandleInformation(handle, 1, 1));
      IntPtr size = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
      attributes = Marshal.AllocHGlobal(size);
      Require(InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); initialized = true;
      jobList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, job);
      Require(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
      startup.Attributes = attributes;
      var command = new StringBuilder(Quote(executable));
      foreach (string arg in args) command.Append(" ").Append(Quote(arg));
      // Atomic job assignment also covers cancellation during process creation.
      Require(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08080004, IntPtr.Zero, cwd, ref startup, out process));
      Console.Out.WriteLine("{\"type\":\"dfsc_runtime_job\",\"job\":\"" + name.Replace("\\", "\\\\") + "\",\"pid\":" + process.Pid + "}");
      Console.Out.Flush();
      if (ResumeThread(process.Thread) == uint.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
      WaitForSingleObject(process.Process, uint.MaxValue);
      uint code; Require(GetExitCodeProcess(process.Process, out code));
      Require(TerminateJobObject(job, 0));
      for (int i = 0; i < 100 && !Empty(job); i++) Thread.Sleep(50);
      if (!Empty(job)) throw new InvalidOperationException("Runtime job release unconfirmed");
      return unchecked((int)code);
    } finally {
      if (process.Process != IntPtr.Zero) { TerminateProcess(process.Process, 1); CloseHandle(process.Process); }
      if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
      if (initialized) DeleteProcThreadAttributeList(attributes);
      if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
      CloseHandle(job);
    }
  }
}
'@
try {
  if ($Verify) {
    if ($Verify -notmatch '^Local\\DFSC-[a-f0-9-]{36}$') { exit 2 }
    if ([DfscRuntimeJob]::Released($Verify)) { exit 0 }
    exit 1
  }
  $launch = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Spec)) | ConvertFrom-Json
  if ($launch.job -notmatch '^Local\\DFSC-[a-f0-9-]{36}$') { exit 2 }
  exit [DfscRuntimeJob]::Run($launch.job, $launch.node, [string[]]$launch.args, $launch.cwd)
} catch {
  [Console]::Error.WriteLine('Desktop runtime job failed.')
  exit 1
}
