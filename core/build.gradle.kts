plugins {
    application
    java
}

group = "ru.sofy"
version = "0.0.3"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(22)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.xerial:sqlite-jdbc:3.54.1.0")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.22.4")
    implementation("org.slf4j:slf4j-simple:2.0.20")
    implementation("net.jthink:jaudiotagger:3.0.1")
}

application {
    mainClass = "ru.sofy.core.SoFyCore"
    applicationDefaultJvmArgs = listOf("-Dfile.encoding=UTF-8")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-Xlint:all")
    // Java 21 bytecode so the core runs on any modern runtime, not only JDK 22+
    options.release.set(21)
}

tasks.register<Jar>("fatJar") {
    group = "build"
    description = "Single runnable jar for the Electron host"
    archiveBaseName.set("sofy-core")
    archiveVersion.set("")
    archiveClassifier.set("all")
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    manifest {
        attributes["Main-Class"] = "ru.sofy.core.SoFyCore"
    }
    from(sourceSets.main.get().output)
    dependsOn(configurations.runtimeClasspath)
    from({
        configurations.runtimeClasspath.get()
            .filter { it.name.endsWith(".jar") }
            .map { zipTree(it) }
    }) {
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "module-info.class")
    }
}
