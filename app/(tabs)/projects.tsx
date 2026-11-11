import { AppText } from '@/presentation/components/AppText';
import { Notice } from '@/presentation/components/Notice';
import { Screen, ScreenSection } from '@/presentation/components/Screen';
import { StyleSheet, View } from 'react-native';

export default function ProjectsScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="eyebrow" muted>Projects · 长期作品</AppText>
        <AppText variant="title">项目不必在一个{`\n`}阶段里做完。</AppText>
      </View>
      <ScreenSection>
        <AppText variant="heading">项目空间</AppText>
        <Notice title="将在 Phase 11 开放">
          Project 会作为跨 Period 实体保存，阶段结束只记录版本和成果，不会重置项目。
        </Notice>
      </ScreenSection>
    </Screen>
  );
}

const styles = StyleSheet.create({ header: { gap: 8 } });
