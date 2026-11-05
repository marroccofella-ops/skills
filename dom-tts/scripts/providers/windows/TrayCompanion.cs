// Signed optional GUI companion for the existing explicitly enabled browser server.
// No transcript scan, microphone, native-policy fallback or recorded-PID termination.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
class TrayCompanion : ApplicationContext {
 const string StartupName="DomTTSReviewedTray";
 readonly NotifyIcon icon;
 readonly Control dispatcher=new Control();
 readonly string state;
 bool closing;
 class Connection {public string Origin;public string Token;}
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=8192};
 [STAThread] static int Main(string[] args){
  if(args.Length!=0)return 2;
  if(!TrustedSelf()){MessageBox.Show("Dom TTS tray requires the exact reviewed publisher-signed build.","Dom TTS");return 1;}
  bool created;using(var mutex=new Mutex(true,"Local\\DomTTS.Tray."+WindowsIdentity.GetCurrent().User.Value,out created)){
   if(!created){MessageBox.Show("The Dom TTS tray is already running.","Dom TTS");return 1;}
   try{Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new TrayCompanion());return 0;}finally{mutex.ReleaseMutex();}
  }
 }
 TrayCompanion(){
  state=StateDirectory();dispatcher.CreateControl();
  var menu=new ContextMenuStrip();
  menu.Items.Add(new ToolStripMenuItem("Open spoken replies unavailable"){Enabled=false,ToolTipText="Use the link printed by a freshly started companion; this tray has no verified browser transport."});
  Add(menu,"Pause after current",()=>Call("queue/pause"));Add(menu,"Resume queue",()=>Call("queue/resume"));Add(menu,"Skip current",()=>Call("queue/skip"));
  Add(menu,"Stop speech and clear queue",()=>Call("stop"));Add(menu,"Restart stopped queue",()=>Call("queue/restart"));
  menu.Items.Add(new ToolStripSeparator());
  menu.Items.Add(new ToolStripMenuItem("Start at login unavailable"){Enabled=false,ToolTipText="Requires a verified managed launcher; arbitrary tray paths are never persisted."});Add(menu,"Remove this tray from login",DisableStartup);
  Add(menu,"About",()=>MessageBox.Show("Dom TTS "+TrustedPublisherIdentity.Version+" tray.\nRequires the separate local browser companion and explicit Enable.\nClosing the tray does not stop an independently owned server.\nOnly a reviewed, trusted signed build may be installed.","Dom TTS"));
  Add(menu,"Exit tray",()=>{closing=true;icon.Visible=false;icon.Dispose();dispatcher.Dispose();ExitThread();});
  icon=new NotifyIcon{Text="Dom TTS spoken replies",Icon=SystemIcons.Information,ContextMenuStrip=menu,Visible=true};
  icon.DoubleClick+=(s,e)=>Notice("Use the link printed by a freshly started companion. Tray browser actions are unavailable in this build.");
 }
 void Add(ContextMenuStrip menu,string title,Action action){menu.Items.Add(title,null,(s,e)=>{if(title=="Exit tray"||title=="About")action();else Work(action);});}
 void Work(Action action){ThreadPool.QueueUserWorkItem(_=>{try{action();Notice("Action completed. Check the companion for playback status.");}catch{Notice("Tray browser actions are unavailable in this build. Use the link printed by a freshly started companion.");}});}
 void Notice(string message){if(closing||dispatcher.IsDisposed)return;try{dispatcher.BeginInvoke((Action)(()=>{if(!closing){icon.BalloonTipTitle="Dom TTS";icon.BalloonTipText=message;icon.ShowBalloonTip(3000);}}));}catch{}}
 void CheckAcl(FileSystemSecurity acl){string owner=WindowsIdentity.GetCurrent().User.Value;if(((SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier))).Value!=owner)throw new InvalidDataException();foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(rule.AccessControlType==AccessControlType.Allow){string sid=((SecurityIdentifier)rule.IdentityReference).Value;if(sid!=owner&&sid!="S-1-5-18"&&sid!="S-1-5-32-544")throw new InvalidDataException();}}
 Connection Load(){
  string file=Path.Combine(state,"browser-session.json");for(string part=state;!String.IsNullOrEmpty(part);part=Path.GetDirectoryName(part))if((File.GetAttributes(part)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException();if(!Directory.Exists(state))throw new InvalidDataException();CheckAcl(Directory.GetAccessControl(state));
  var info=new FileInfo(file);if(!info.Exists||info.Length>4096||(info.Attributes&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException();CheckAcl(File.GetAccessControl(file));
  var data=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,new UTF8Encoding(false,true)));if(data==null||!data.ContainsKey("schema")||(string)data["schema"]!="dom-tts-browser/1"||!data.ContainsKey("port")||!(data["port"] is int)||!data.ContainsKey("token")||!(data["token"] is string))throw new InvalidDataException();
  int port=(int)data["port"];string token=(string)data["token"];if(port<1||port>65535||!System.Text.RegularExpressions.Regex.IsMatch(token,"^[a-f0-9]{64}$"))throw new InvalidDataException();return new Connection{Origin="http://127.0.0.1:"+port,Token=token};
 }
 void Call(string action){throw new InvalidOperationException("Verified browser transport is required; tray browser actions are unavailable in this build.");}
 static string StateDirectory(){string selected=Environment.GetEnvironmentVariable("DOM_TTS_STATE_DIR");if(String.IsNullOrEmpty(selected))return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"42uk","DomTTS","0.5");if(!System.Text.RegularExpressions.Regex.IsMatch(selected,@"\A(?:[A-Za-z]:[\\/]|\\\\[^\\/]+\\[^\\/]+(?:\\|$))"))throw new InvalidDataException("State directory must be an absolute path.");return Path.GetFullPath(selected);}
 static void NoLinks(string file){for(string part=Path.GetFullPath(file);!String.IsNullOrEmpty(part);part=Path.GetDirectoryName(part))if((File.Exists(part)||Directory.Exists(part))&&(File.GetAttributes(part)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException();}
 static bool TrustedSelf(){try{string file=System.Reflection.Assembly.GetExecutingAssembly().Location;NoLinks(file);if((FileVersionInfo.GetVersionInfo(file).ProductVersion!=TrustedPublisherIdentity.Version||FileVersionInfo.GetVersionInfo(file).ProductName!=TrustedPublisherIdentity.ProductName))return false;string powershell=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"),command="$ErrorActionPreference='Stop'; $env:PSModulePath=Join-Path $PSHOME 'Modules'; $s=Get-AuthenticodeSignature -LiteralPath '"+file.Replace("'","''")+"'; [ordered]@{status=[string]$s.Status;signatureType=[string]$s.SignatureType;thumbprint=if($s.SignerCertificate){[string]$s.SignerCertificate.Thumbprint}else{''}}|ConvertTo-Json -Compress";
  var start=new ProcessStartInfo(powershell,"-NoProfile -NonInteractive -Command "+Quote(command)){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};foreach(string key in new[]{"NODE_OPTIONS","NODE_PATH","ELECTRON_RUN_AS_NODE","PSModulePath"})start.EnvironmentVariables.Remove(key);var output=new StringBuilder();using(var child=new Process{StartInfo=start}){child.OutputDataReceived+=(o,e)=>{if(e.Data!=null)lock(output){if(output.Length<8192)output.AppendLine(e.Data.Substring(0,Math.Min(e.Data.Length,8192-output.Length)));}};child.ErrorDataReceived+=(o,e)=>{};if(!child.Start())return false;child.BeginOutputReadLine();child.BeginErrorReadLine();if(!child.WaitForExit(15000)){try{child.Kill();child.WaitForExit(5000);}catch{}return false;}child.WaitForExit();if(child.ExitCode!=0)return false;string text;lock(output)text=output.ToString();var facts=Json.Deserialize<Dictionary<string,object>>(text);return (string)facts["status"]=="Valid"&&(string)facts["signatureType"]=="Authenticode"&&TrustedPublisherIdentity.ApprovedThumbprint(facts["thumbprint"] as string);}}catch{return false;}}
 static string Quote(string value){var result=new StringBuilder("\"");int slashes=0;foreach(char ch in value){if(ch=='\\'){slashes++;continue;}if(ch=='\"'){result.Append('\\',slashes*2+1);result.Append(ch);}else{result.Append('\\',slashes);result.Append(ch);}slashes=0;}result.Append('\\',slashes*2);result.Append('"');return result.ToString();}
 static string StartupValue(){string executable=Process.GetCurrentProcess().MainModule.FileName;if(executable.IndexOf('"')>=0)throw new InvalidDataException();return "\""+executable+"\"";}
 void EnableStartup(){throw new InvalidOperationException("Start at login is unavailable until a verified managed launcher is supplied.");}
 void DisableStartup(){using(var key=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run",true)){if(key==null)return;var existing=key.GetValue(StartupName) as string;if(existing!=null&&existing!=StartupValue())throw new InvalidDataException();if(existing!=null)key.DeleteValue(StartupName,false);}}
}
