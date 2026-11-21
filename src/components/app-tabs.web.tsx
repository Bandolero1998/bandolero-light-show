import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function AppTabs() {
  return <Tabs><TabSlot style={{flex:1}}/><TabList asChild><View style={s.bar}>
    <TabTrigger name="index" href="/" asChild><Pressable style={s.tab}><Text style={s.label}>HOME</Text></Pressable></TabTrigger>
    <TabTrigger name="garage" href="/garage" asChild><Pressable style={s.tab}><Text style={s.label}>GARAGE</Text></Pressable></TabTrigger>
    <TabTrigger name="light-show" href={"/light-show" as any} asChild><Pressable style={s.tab}><Text style={s.label}>LIGHT SHOW</Text></Pressable></TabTrigger>
    <TabTrigger name="ai-assistant" href={"/ai-assistant" as any} asChild><Pressable style={s.tab}><Text style={s.label}>AI</Text></Pressable></TabTrigger>
    <TabTrigger name="settings" href={"/settings" as any} asChild><Pressable style={s.tab}><Text style={s.label}>SETTINGS</Text></Pressable></TabTrigger>
  </View></TabList></Tabs>;
}
const s=StyleSheet.create({bar:{position:'absolute',bottom:14,left:12,right:12,backgroundColor:'#171323',borderColor:'#39234D',borderWidth:1,borderRadius:16,padding:7,flexDirection:'row',justifyContent:'space-around'},tab:{paddingVertical:12,paddingHorizontal:8},label:{color:'#C084FC',fontSize:9,fontWeight:'900',letterSpacing:1}});
