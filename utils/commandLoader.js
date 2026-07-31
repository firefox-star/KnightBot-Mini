/**
 * Command Loader - Loads built-in commands + restores plugins
 */

const fs = require('fs');
const path = require('path');

let commandsMap = null;

function getCommandMap() {
	return commandsMap;
}

function registerRegistryCommands(commands, modulePath, label) {
  try {
    const list = require(modulePath);
    for (const cmd of list) {
      if (!cmd?.name) continue;
      commands.set(cmd.name, cmd);
      cmd.aliases?.forEach((alias) => commands.set(alias, cmd));
    }
  } catch (error) {
    console.error(`Error loading ${label} commands:`, error.message);
  }
}

function registerFunCommands(commands) {
  registerRegistryCommands(commands, './funCommands', 'fun');
}

function registerEconomyCommands(commands) {
  registerRegistryCommands(commands, './economyCommands', 'economy');
}

const loadCommands = () => {
  commandsMap = new Map();
  const commandsPath = path.join(__dirname, '..', 'commands');
  
  if (!fs.existsSync(commandsPath)) {
    console.log('Commands directory not found');
    return commandsMap;
  }
  
  const categories = fs.readdirSync(commandsPath);
  
  categories.forEach(category => {
    const categoryPath = path.join(commandsPath, category);
    if (fs.statSync(categoryPath).isDirectory()) {
      const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
      
      files.forEach(file => {
        try {
          const command = require(path.join(categoryPath, file));
          if (command.name) {
            commandsMap.set(command.name, command);
            if (command.aliases) {
              command.aliases.forEach(alias => {
                commandsMap.set(alias, command);
              });
            }
          }
        } catch (error) {
          console.error(`Error loading command ${file}:`, error.message);
        }
      });
    }
  });
  
  registerFunCommands(commandsMap);
  registerEconomyCommands(commandsMap);

  // Restore plugins from gist registry (re-downloads if files missing)
  const { restorePlugins } = require('./pluginManager');
  restorePlugins(commandsMap).then(count => {
    if (count > 0) console.log(`🔌 ${count} plugin(s) active`);
  }).catch(err => {
    console.error('Plugin restore failed:', err.message);
  });

  return commandsMap;
};

module.exports = { loadCommands, getCommandMap, registerFunCommands, registerEconomyCommands };
